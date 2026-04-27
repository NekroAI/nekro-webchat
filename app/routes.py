from __future__ import annotations

import sys
import subprocess
try:
    from PIL import Image
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "pillow"], capture_output=True)

import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, File as FastAPIFile, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.auth import User, get_current_user, get_optional_current_user, get_ws_user
from app.database import (
    Conversation,
    ChatMessage,
    SessionLocal,
    conversation_to_dict,
    create_conversation,
    ensure_conversation_invite_key,
    get_conversation,
    get_or_create_user_default_conversation,
    join_conversation_by_invite_key,
    list_recent_messages,
    list_user_conversations,
    update_conversation_profile,
    user_can_access_conversation,
)
from app.sse_client import client, ensure_subscribed
from app.utils import cleanup_uploaded_files, get_upload_path, message_payload, resolve_sender_avatars

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"

router = APIRouter()


# ---------------------------------------------------------------------------
# 会话列表辅助函数
# ---------------------------------------------------------------------------

async def generate_group_avatar(channel_id: str, session) -> str | None:
    """根据群成员头像生成拼接的群头像。

    布局规则:
    - 1 人: 居中圆形
    - 2 人: 左右各一半
    - 3 人: 上 1 + 下 2
    - 4 人: 2×2 网格
    - 5 人: 上 2 + 下 3
    - 6 人: 3×2 → 两行各 3
    - 7 人: 上 1 + 中 3 + 下 3
    - 8 人: 上 2 + 中 3 + 下 3
    - 9 人: 3×3 九宫格
    """
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        import subprocess as _sp, sys as _sys
        try:
            _sp.run([_sys.executable, "-m", "pip", "install", "pillow"], capture_output=True)
            from PIL import Image, ImageDraw
        except Exception:
            return None

    from app.database import Conversation, ConversationMember
    from app.auth import User as DBUser
    from sqlalchemy import select

    res = await session.execute(
        select(Conversation).where(Conversation.channel_id == channel_id)
    )
    conv = res.scalar_one_or_none()
    if not conv:
        return None

    members_res = await session.execute(
        select(ConversationMember).where(ConversationMember.conversation_id == conv.id)
    )
    members = members_res.scalars().all()

    owner_res = await session.execute(
        select(DBUser).where(DBUser.id == conv.user_id)
    )
    owner = owner_res.scalar_one_or_none()

    member_ids = [m.user_id for m in members]
    if owner and str(owner.id) not in member_ids:
        member_ids.insert(0, str(owner.id))

    seen: set[str] = set()
    unique_member_ids: list[str] = []
    for mid in member_ids:
        if mid not in seen:
            seen.add(mid)
            unique_member_ids.append(mid)
    unique_member_ids = unique_member_ids[:9]
    if not unique_member_ids:
        return None

    avatars_res = await session.execute(
        select(DBUser).where(DBUser.id.in_(unique_member_ids))
    )
    users_map = {str(u.id): u for u in avatars_res.scalars().all()}

    avatar_urls: list[str] = []
    for mid in unique_member_ids:
        u = users_map.get(mid)
        avatar_urls.append(u.avatar if (u and u.avatar) else "/static/user.png")

    base_dir = Path(__file__).resolve().parent.parent

    def _load_avatar(url: str) -> Image.Image:
        clean = url.split("?")[0].lstrip("/")
        p = base_dir / clean
        if p.exists() and p.is_file():
            try:
                return Image.open(p).convert("RGBA")
            except Exception:
                pass
        fallback = base_dir / "static" / "user.png"
        if fallback.exists():
            return Image.open(fallback).convert("RGBA")
        return Image.new("RGBA", (100, 100), (200, 200, 200, 255))

    def _circle_crop(img: Image.Image, size: int) -> Image.Image:
        img = img.resize((size, size), Image.Resampling.LANCZOS)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse((0, 0, size, size), fill=255)
        result = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        result.paste(img, (0, 0), mask)
        return result

    def _cover_crop(img: Image.Image, tw: int, th: int) -> Image.Image:
        """缩放后居中裁剪到 tw×th (cover 模式)"""
        w, h = img.size
        scale = max(tw / w, th / h)
        nw, nh = int(w * scale), int(h * scale)
        img = img.resize((nw, nh), Image.Resampling.LANCZOS)
        left = (nw - tw) // 2
        top = (nh - th) // 2
        return img.crop((left, top, left + tw, top + th))

    CANVAS = 800
    BG_COLOR = (230, 233, 237, 255)
    GAP = 16

    # 根据人数确定每行的头像数量
    LAYOUTS: dict[int, list[int]] = {
        1: [1],
        2: [2],
        3: [1, 2],
        4: [2, 2],
        5: [2, 3],
        6: [3, 3],
        7: [1, 3, 3],
        8: [2, 3, 3],
        9: [3, 3, 3],
    }

    n = len(avatar_urls)
    bg = Image.new("RGBA", (CANVAS, CANVAS), BG_COLOR)

    if n == 2:
        # 左右布局: 两人各占半边，中间留一条窄缝
        half_w = (CANVAS - GAP) // 2
        img1 = _cover_crop(_load_avatar(avatar_urls[0]), half_w, CANVAS)
        img2 = _cover_crop(_load_avatar(avatar_urls[1]), half_w, CANVAS)

        mask1 = Image.new("L", (half_w, CANVAS), 0)
        ImageDraw.Draw(mask1).rounded_rectangle(
            (0, 0, half_w, CANVAS), radius=40, fill=255,
        )
        mask2 = Image.new("L", (half_w, CANVAS), 0)
        ImageDraw.Draw(mask2).rounded_rectangle(
            (0, 0, half_w, CANVAS), radius=40, fill=255,
        )

        r1 = Image.new("RGBA", (half_w, CANVAS), (0, 0, 0, 0))
        r1.paste(img1, (0, 0), mask1)
        r2 = Image.new("RGBA", (half_w, CANVAS), (0, 0, 0, 0))
        r2.paste(img2, (0, 0), mask2)

        bg.paste(r1, (0, 0), r1)
        bg.paste(r2, (half_w + GAP, 0), r2)
    else:
        rows = LAYOUTS.get(n, [3, 3, 3])
        num_rows = len(rows)
        cell_h = (CANVAS - GAP * (num_rows + 1)) // num_rows
        cell_size = cell_h

        idx = 0
        for r_idx, cols_in_row in enumerate(rows):
            row_cell_w = (CANVAS - GAP * (cols_in_row + 1)) // cols_in_row
            actual_size = min(cell_size, row_cell_w)
            row_total_w = actual_size * cols_in_row + GAP * (cols_in_row - 1)
            x_offset = (CANVAS - row_total_w) // 2
            y = GAP + r_idx * (cell_h + GAP) + (cell_h - actual_size) // 2

            for c_idx in range(cols_in_row):
                if idx >= n:
                    break
                x = x_offset + c_idx * (actual_size + GAP)
                avatar_img = _circle_crop(_load_avatar(avatar_urls[idx]), actual_size)
                bg.paste(avatar_img, (x, y), avatar_img)
                idx += 1

    upload_dir = base_dir / "data" / channel_id / "icon"
    upload_dir.mkdir(parents=True, exist_ok=True)
    target = upload_dir / "default_group.webp"

    bg.convert("RGB").save(target, "WEBP", quality=90)

    conv.channel_avatar = f"/data/{channel_id}/icon/default_group.webp"
    await session.commit()

    return f"/data/{channel_id}/icon/default_group.webp"


async def _invalidate_group_avatar(channel_id: str, session) -> None:
    """将群头像重置为空，使下次 pack_single_conversation 时重新生成拼接头像。

    仅当当前头像是自动生成的 default_group 时才重置；
    用户手动上传的自定义头像不受影响。
    """
    from sqlalchemy import select

    res = await session.execute(
        select(Conversation).where(Conversation.channel_id == channel_id)
    )
    conv = res.scalar_one_or_none()
    if conv and conv.channel_avatar and "default_group" in conv.channel_avatar:
        conv.channel_avatar = ""


async def pack_single_conversation(session, conv: Conversation) -> dict[str, Any]:
    """
    组装单个会话的详细信息，并附加上最后一条聊天消息的预览。
    """
    from sqlalchemy import select
    from app.database import ChatMessage
    from app.auth import User

    # 查询当前会话的最新一条消息
    msg_res = await session.execute(
        select(ChatMessage)
        .where(ChatMessage.conversation_id == conv.id)
        .order_by(ChatMessage.id.desc())
        .limit(1)
    )
    last_msg = msg_res.scalar_one_or_none()
    
    d = conversation_to_dict(conv)

    if conv.kind == "group" and (not d.get("channel_avatar") or "default_group.webp" in d.get("channel_avatar")):
        try:
            avatar_path = await generate_group_avatar(conv.channel_id, session)
            if avatar_path:
                import time
                d["channel_avatar"] = f"{avatar_path}?t={int(time.time())}"
        except Exception as e:
            import traceback
            from pathlib import Path
            log_path = Path(__file__).resolve().parent / "error.log"
            with open(log_path, "a", encoding="utf-8") as f:
                f.write(f"--- 错误产生 ---\n")
                f.write(traceback.format_exc())
                f.write("\n")

    if conv.user_id:
        u_res = await session.execute(select(User).where(User.id == conv.user_id))
        owner_user = u_res.scalar_one_or_none()
        if owner_user:
            d["ai_avatar"] = owner_user.ai_avatar or ""
    
    # 格式化最后一条消息的展示文本
    if last_msg:
        if last_msg.file_url:
            suffix = Path(last_msg.file_name or last_msg.file_url or "").suffix.lower()
            is_image = (last_msg.mime_type or "").startswith("image/") or suffix in {
                ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".avif"
            }
            if is_image:
                content = (last_msg.content or "").strip()
                if content.startswith("[表情包]"):
                    sticker_name = content.removeprefix("[表情包]").strip() or Path(last_msg.file_name or "").stem or "表情"
                    d["last_message"] = f"[动画表情] {sticker_name}"
                else:
                    d["last_message"] = f"[图片] {last_msg.file_name}"
            else:
                d["last_message"] = f"[文件] {last_msg.file_name}"
        else:
            d["last_message"] = last_msg.content
    else:
        d["last_message"] = "暂无消息"
    return d


async def get_conversations_with_last_message(session, user_id: str) -> list[dict[str, Any]]:
    """
    按更新时间倒序获取当前账号绑定的 chatkey 列表。
    """
    convs = await list_user_conversations(user_id)
    return [await pack_single_conversation(session, c) for c in convs]


# ---------------------------------------------------------------------------
# HTTP 路由接口
# ---------------------------------------------------------------------------

@router.get("/")
async def index() -> FileResponse:
    """提供单页面应用的首页 HTML 载入。"""
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/invite/{invite_key}")
async def invite_page(invite_key: str) -> FileResponse:
    """邀请链接入口，实际加入逻辑由登录后的前端调用 API 完成。"""
    return FileResponse(STATIC_DIR / "index.html")


@router.get("/api/status")
async def status() -> dict[str, Any]:
    """获取应用配置，以及与 NekroAgent 平台的连接健康状态。"""
    from app.config import settings

    return {
        "settings": {
            "server_url": settings.nekro_server_url,
            "platform": settings.webchat_platform,
        },
        "client": client.get_stats(),
    }


@router.get("/api/conversations")
async def api_conversations(_user: User = Depends(get_current_user)) -> dict[str, Any]:
    """获取完整的会话历史列表，带最新一条消息预览。"""
    user_id = str(_user.id)
    user_name = _user.display_name or _user.username
    async with SessionLocal() as session:
        items = await get_conversations_with_last_message(session, user_id)
        
        # 每个账号有一个稳定且强绑定的默认 chatkey。
        if not items:
            conversation = await get_or_create_user_default_conversation(
                user_id=user_id,
                user_name=user_name,
            )
            await ensure_subscribed(conversation.channel_id)
            items = [await pack_single_conversation(session, conversation)]
            
        return {"items": items}


@router.delete("/api/conversations/{channel_id}")
async def api_delete_conversation(channel_id: str, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    """用户删除单个对话会话。"""
    from app.database import SessionLocal, Conversation, ChatMessage, ConversationMember
    from sqlalchemy import delete, select
    
    async with SessionLocal() as session:
        # 1. 映射 channel_id 获取 UUID
        res = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        conversation = res.scalar_one_or_none()
        if not conversation:
            raise HTTPException(status_code=404, detail="会话不存在")
            
        conv_id = conversation.id
        
        # 2. 移除级联关联信息
        await session.execute(delete(ChatMessage).where(ChatMessage.conversation_id == conv_id))
        await session.execute(delete(ConversationMember).where(ConversationMember.conversation_id == conv_id))
        await session.execute(delete(Conversation).where(Conversation.id == conv_id))
        await session.commit()
    return {"status": "ok"}


@router.post("/api/conversations")
async def api_create_conversation(payload: dict[str, str], _user: User = Depends(get_current_user)) -> dict[str, Any]:
    """用户在前端主动创建一个新的 AI 对话。"""
    user_id = str(_user.id)
    conversation = await create_conversation(
        payload.get("channel_name", "新对话"),
        user_id=user_id,
        user_name=_user.display_name or _user.username,
        kind="direct",
    )
    # 在 SSE 客户端向 NekroAgent 监听此频道
    await ensure_subscribed(conversation.channel_id)
    async with SessionLocal() as session:
        return await pack_single_conversation(session, conversation)


@router.post("/api/groups")
async def api_create_group(payload: dict[str, str], _user: User = Depends(get_current_user)) -> dict[str, Any]:
    """创建一个群聊频道，可通过邀请链接让其他账号加入。"""
    user_id = str(_user.id)
    conversation = await create_conversation(
        payload.get("channel_name", "新群聊"),
        user_id=user_id,
        user_name=_user.display_name or _user.username,
        kind="group",
    )
    await ensure_subscribed(conversation.channel_id)
    async with SessionLocal() as session:
        return await pack_single_conversation(session, conversation)


@router.post("/api/conversations/{channel_id}/avatar")
async def api_upload_channel_avatar(
    channel_id: str,
    file_data: UploadFile = FastAPIFile(...), 
    _user: User = Depends(get_current_user)
) -> dict[str, Any]:
    from app.database import SessionLocal, Conversation
    from sqlalchemy import select
    import shutil
    from pathlib import Path
    import uuid
    from fastapi import HTTPException

    async with SessionLocal() as session:
        res = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        conversation = res.scalar_one_or_none()
        if not conversation:
            raise HTTPException(status_code=404, detail="会话不存在")
            
        if conversation.kind == "group" and str(conversation.user_id) != str(_user.id):
            raise HTTPException(status_code=403, detail="只有群主可以设置群聊头像")
        elif conversation.kind != "group" and str(conversation.user_id) != str(_user.id):
            raise HTTPException(status_code=403, detail="无权设置该对话头像")

        base_dir = Path(__file__).resolve().parent.parent
        upload_dir = base_dir / "data" / channel_id / "icon"
        upload_dir.mkdir(parents=True, exist_ok=True)
        
        for old_file in upload_dir.glob("*"):
            if old_file.is_file():
                old_file.unlink()
                
        ext = Path(file_data.filename or "file").suffix or ".webp"
        unique_filename = f"{uuid.uuid4().hex}{ext}"
        target = upload_dir / unique_filename
        
        with target.open("wb") as out:
            shutil.copyfileobj(file_data.file, out)
            
        file_url = f"/data/{channel_id}/icon/{unique_filename}"
        
        conversation.channel_avatar = file_url
        await session.commit()
        await session.refresh(conversation)
        
        return {"channel_avatar": file_url}


@router.post("/api/conversations/{channel_id}/avatar/regenerate")
async def api_regenerate_group_avatar(
    channel_id: str,
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """强制重新生成群聊的成员拼接头像。"""
    from sqlalchemy import select
    import time

    async with SessionLocal() as session:
        res = await session.execute(
            select(Conversation).where(Conversation.channel_id == channel_id)
        )
        conv = res.scalar_one_or_none()
        if not conv or conv.kind != "group":
            raise HTTPException(status_code=404, detail="群聊不存在")
        if str(conv.user_id) != str(_user.id):
            raise HTTPException(status_code=403, detail="只有群主可以重新生成群头像")

        avatar_path = await generate_group_avatar(channel_id, session)
        if not avatar_path:
            raise HTTPException(status_code=500, detail="生成群头像失败")
        return {"channel_avatar": f"{avatar_path}?t={int(time.time())}"}


@router.patch("/api/conversations/{channel_id}")
async def api_update_conversation(channel_id: str, payload: dict[str, str], _user: User = Depends(get_current_user)) -> dict[str, Any]:
    """修改某个会话的属性（如：AI昵称、用户头像等）。"""
    conversation = await get_conversation(channel_id)
    if not conversation or conversation.user_id != str(_user.id):
        raise HTTPException(status_code=403, detail="会话不存在或无权访问")
    
    conversation = await update_conversation_profile(channel_id, payload)
    async with SessionLocal() as session:
        return await pack_single_conversation(session, conversation)


@router.get("/api/conversations/{channel_id}/messages")
async def api_messages(channel_id: str, before_id: int | None = None, limit: int = 50, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    """获取指定会话的历史聊天记录（支持分页）。"""
    conversation = await get_conversation(channel_id)
    if not conversation or not await user_can_access_conversation(channel_id, str(_user.id)):
        raise HTTPException(status_code=403, detail="会话不存在或无权访问")
        
    rows = await list_recent_messages(channel_id, before_id=before_id, limit=limit)
    avatars = await resolve_sender_avatars(rows)
    return {"items": [message_payload(row, conversation, sender_avatar=avatars.get(row.sender_id, "")) for row in rows]}


@router.get("/api/conversations/{channel_id}/invite")
async def api_conversation_invite(channel_id: str, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    """获取当前账号可访问群聊的邀请信息。"""
    conversation = await get_conversation(channel_id)
    if not conversation or not await user_can_access_conversation(channel_id, str(_user.id)):
        raise HTTPException(status_code=403, detail="会话不存在或无权访问")
    if conversation.kind != "group":
        raise HTTPException(status_code=400, detail="只有群聊可以生成邀请链接")

    conversation = await ensure_conversation_invite_key(channel_id)
    assert conversation is not None
    return {
        "channel_id": conversation.channel_id,
        "invite_key": conversation.invite_key,
        "invite_path": f"/invite/{conversation.invite_key}",
    }


@router.post("/api/invite/{invite_key}/join")
async def api_join_invite(invite_key: str, _user: User = Depends(get_current_user)) -> dict[str, Any]:
    """通过邀请 key 加入群聊。"""
    conversation = await join_conversation_by_invite_key(
        invite_key=invite_key,
        user_id=str(_user.id),
        user_name=_user.display_name or _user.username,
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="邀请链接无效或已过期")

    await ensure_subscribed(conversation.channel_id)
    async with SessionLocal() as session:
        await _invalidate_group_avatar(conversation.channel_id, session)
        return await pack_single_conversation(session, conversation)


@router.post("/api/upload")
async def api_upload(
    background_tasks: BackgroundTasks,
    file_data: UploadFile = FastAPIFile(...), 
    channel_id: str | None = Form(None),
    _user: User = Depends(get_current_user)
) -> dict[str, Any]:
    """
    通用文件/图片上传接口。
    文件保存在 /data/user/uid/uploads/频道ID
    如果在群聊则保存在群主的 UID 下
    """
    from app.config import settings
    from app.database import SessionLocal, Conversation
    from sqlalchemy import select
    import uuid
    from fastapi import HTTPException
    import shutil

    # 1. 限制上传文件的最大大小
    if settings.max_upload_size_mb > 0:
        max_bytes = settings.max_upload_size_mb * 1024 * 1024
        file_data.file.seek(0, 2)
        file_size = file_data.file.tell()
        file_data.file.seek(0)
        if file_size > max_bytes:
            raise HTTPException(status_code=413, detail=f"文件体积过大，最大限制为 {settings.max_upload_size_mb}MB")

    # 2. 异步自动清理
    background_tasks.add_task(cleanup_uploaded_files)

    mime = file_data.content_type or "application/octet-stream"
    uid = str(_user.id)
    cid = channel_id or "default"

    # 3. 确定群主 UID 或是拥有者 UID
    if channel_id:
        async with SessionLocal() as session:
            res = await session.execute(select(Conversation).where(Conversation.id == channel_id))
            conversation = res.scalar_one_or_none()
            if conversation and conversation.user_id:
                uid = conversation.user_id

    # 路径拼接
    base_dir = Path(__file__).resolve().parent.parent
    upload_dir = base_dir / "data" / "user" / uid / "uploads" / cid
    upload_dir.mkdir(parents=True, exist_ok=True)
    
    ext = Path(file_data.filename or "file").suffix
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    target = upload_dir / unique_filename

    with target.open("wb") as out:
        shutil.copyfileobj(file_data.file, out)

    file_url = f"/data/user/{uid}/uploads/{cid}/{unique_filename}"
    return {
        "file_url": file_url,
        "file_name": Path(file_data.filename or "file").name,
        "mime_type": mime,
        "file_size": target.stat().st_size,
        "file_path": str(target),
    }

@router.post("/api/conversations/{channel_id}/leave")
async def leave_conversation(
    channel_id: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, str]:
    from app.database import SessionLocal, get_conversation, ConversationMember, Conversation
    from sqlalchemy import delete, select
    from fastapi import HTTPException

    async with SessionLocal() as session:
        result = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        conversation = result.scalar_one_or_none()
        if not conversation:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        if conversation.user_id == str(current_user.id):
            raise HTTPException(status_code=400, detail="群主不能退出群聊")

        await session.execute(
            delete(ConversationMember).where(
                ConversationMember.conversation_id == conversation.id,
                ConversationMember.user_id == str(current_user.id),
            )
        )
        await _invalidate_group_avatar(channel_id, session)
        await session.commit()
    return {"detail": "已成功退出群聊"}

@router.get("/api/conversations/{channel_id}/members")
async def list_conversation_members(
    channel_id: str,
    current_user: User = Depends(get_current_user)
) -> list[dict[str, Any]]:
    from app.database import SessionLocal, Conversation, ConversationMember
    from app.auth import User as DBUser
    from sqlalchemy import select
    from fastapi import HTTPException

    async with SessionLocal() as session:
        res = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        conv = res.scalar_one_or_none()
        if not conv:
            raise HTTPException(status_code=404, detail="会话不存在")

        owner_res = await session.execute(select(DBUser).where(DBUser.id == conv.user_id))
        owner_user = owner_res.scalar_one_or_none()

        members_res = await session.execute(select(ConversationMember).where(ConversationMember.conversation_id == conv.id))
        members = members_res.scalars().all()

        ret = []
        if owner_user:
            ret.append({
                "user_id": str(owner_user.id),
                "display_name": owner_user.display_name or owner_user.username,
                "avatar": owner_user.avatar or "/static/user.png",
                "is_owner": True
            })

        member_ids = [m.user_id for m in members if str(m.user_id) != str(conv.user_id)]
        
        if member_ids:
            user_avatars_res = await session.execute(select(DBUser).where(DBUser.id.in_(member_ids)))
            users_map = {str(u.id): u for u in user_avatars_res.scalars().all()}
            
            for m in members:
                if str(m.user_id) == str(conv.user_id):
                    continue
                u = users_map.get(str(m.user_id))
                ret.append({
                    "user_id": str(m.user_id),
                    "display_name": u.display_name if u else (m.user_name or "未知成员"),
                    "avatar": (u.avatar if u else "") or "/static/user.png",
                    "is_owner": False
                })
        else:
            # 如果没人，只有群主
            pass

        return ret


@router.delete("/api/conversations/{channel_id}/members/{user_id}")
async def remove_conversation_member(
    channel_id: str,
    user_id: str,
    current_user: User = Depends(get_current_user)
) -> dict[str, str]:
    from app.database import SessionLocal, Conversation, ConversationMember
    from sqlalchemy import delete, select
    from fastapi import HTTPException

    async with SessionLocal() as session:
        res = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        conv = res.scalar_one_or_none()
        if not conv:
            raise HTTPException(status_code=404, detail="会话不存在")
        
        if str(conv.user_id) != str(current_user.id):
            raise HTTPException(status_code=403, detail="只有群主可以移出成员")
        
        if str(user_id) == str(current_user.id):
            raise HTTPException(status_code=400, detail="不能移出群主自己")

        await session.execute(
            delete(ConversationMember).where(
                ConversationMember.conversation_id == conv.id,
                ConversationMember.user_id == user_id
            )
        )
        await _invalidate_group_avatar(channel_id, session)
        await session.commit()
    return {"detail": "已移出群成员"}


@router.get("/api/download")
async def api_download_file(
    path: str,
    name: str | None = None,
    current_user: User | None = Depends(get_optional_current_user),
    token: str | None = None,
):
    """
    专门为绕过 iOS 平台 download 属性限制而设计的文件流式下载器。
    """
    from fastapi.responses import FileResponse
    from urllib.parse import unquote
    from fastapi import HTTPException
 
    # 普通 <a href> 下载不会附带 Authorization 头，这里允许前端在查询参数中附带 token。
    user = current_user
    if user is None and token:
        user = await get_ws_user(token)
    if user is None:
        raise HTTPException(status_code=401, detail="未提供认证令牌")

    path_str = unquote(path)
    if not path_str.startswith("/data/"):
         raise HTTPException(status_code=403, detail="禁止访问该路径")
         
    relative_path = path_str.lstrip("/")
    base_dir = Path(__file__).resolve().parent.parent
    physical_path = base_dir / relative_path
    
    if not physical_path.exists() or not physical_path.is_file():
         raise HTTPException(status_code=404, detail="文件不存在或已被自动清理")
         
    download_name = name if name else physical_path.name
    
    return FileResponse(
         path=physical_path,
         filename=download_name,
         media_type="application/octet-stream"
    )


@router.get("/static/user.png")
async def get_static_user_png():
    from fastapi.responses import FileResponse
    base_dir = Path(__file__).resolve().parent.parent
    return FileResponse(base_dir / "static" / "user.png")


@router.get("/static/ai.png")
async def get_static_ai_png():
    from fastapi.responses import FileResponse
    base_dir = Path(__file__).resolve().parent.parent
    return FileResponse(base_dir / "static" / "ai.png")
