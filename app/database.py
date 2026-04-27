from __future__ import annotations

from datetime import datetime
from pathlib import Path
import secrets
from typing import Any, Literal

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, delete, or_, select, text as sql_text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from app.config import settings


class Base(DeclarativeBase):
    pass


import uuid

class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    channel_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    channel_name: Mapped[str] = mapped_column(String(128))
    kind: Mapped[str] = mapped_column(String(32), default="direct")
    user_id: Mapped[str] = mapped_column(String(128), default="")
    user_name: Mapped[str] = mapped_column(String(128), default="")
    user_avatar: Mapped[str] = mapped_column(Text, default="")
    ai_name: Mapped[str] = mapped_column(String(128), default="")
    ai_avatar: Mapped[str] = mapped_column(Text, default="")
    invite_key: Mapped[str] = mapped_column(String(64), default="")
    channel_avatar: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    messages: Mapped[list["ChatMessage"]] = relationship(back_populates="conversation")


class ChatMessage(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id"), index=True)
    message_id: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(32))
    sender_id: Mapped[str] = mapped_column(String(128))
    sender_name: Mapped[str] = mapped_column(String(128))
    content: Mapped[str] = mapped_column(Text, default="")
    file_url: Mapped[str] = mapped_column(Text, default="")
    file_name: Mapped[str] = mapped_column(Text, default="")
    mime_type: Mapped[str] = mapped_column(String(128), default="")
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)

    conversation: Mapped[Conversation] = relationship(back_populates="messages")


class ConversationMember(Base):
    __tablename__ = "conversation_members"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_conversation_member_user"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("conversations.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True)
    user_name: Mapped[str] = mapped_column(String(128), default="")
    joined_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)


def user_chatkey(user_id: str | int) -> str:
    return f"direct_{user_id}"


def new_invite_key() -> str:
    return secrets.token_urlsafe(18)


def _normalize_channel_id(channel_id: str, kind: str, owner_user_id: str) -> str:
    if channel_id.count("_") <= 1:
        return channel_id
    if kind == "group":
        suffix = channel_id.rsplit("_", 1)[-1]
        return f"group_{owner_user_id}-{suffix}"
    return f"direct_{owner_user_id}"


def _ensure_sqlite_parent() -> None:
    prefix = "sqlite+aiosqlite:///"
    if not settings.webchat_database_url.startswith(prefix):
        return
    db_path = settings.webchat_database_url.removeprefix(prefix)
    if db_path.startswith(":memory:"):
        return
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)


_ensure_sqlite_parent()
engine = create_async_engine(settings.webchat_database_url, echo=False)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False)


async def _ensure_columns() -> None:
    """SQLite 轻量迁移：给已有 demo 数据库补列。"""
    async with engine.begin() as conn:
        rows = await conn.execute(sql_text("PRAGMA table_info(conversations)"))
        conversation_cols = {row[1] for row in rows.fetchall()}
        conversation_adds = {
            "kind": "TEXT DEFAULT 'direct'",
            "user_id": "TEXT DEFAULT ''",
            "user_name": "TEXT DEFAULT ''",
            "user_avatar": "TEXT DEFAULT ''",
            "ai_name": "TEXT DEFAULT ''",
            "ai_avatar": "TEXT DEFAULT ''",
            "invite_key": "TEXT DEFAULT ''",
            "channel_avatar": "TEXT DEFAULT ''",
        }
        for name, ddl in conversation_adds.items():
            if name not in conversation_cols:
                await conn.execute(sql_text(f"ALTER TABLE conversations ADD COLUMN {name} {ddl}"))

        rows = await conn.execute(sql_text("PRAGMA table_info(messages)"))
        message_cols = {row[1] for row in rows.fetchall()}
        message_adds = {
            "file_url": "TEXT DEFAULT ''",
            "file_name": "TEXT DEFAULT ''",
            "mime_type": "TEXT DEFAULT ''",
            "file_size": "INTEGER DEFAULT 0",
        }
        for name, ddl in message_adds.items():
            if name not in message_cols:
                await conn.execute(sql_text(f"ALTER TABLE messages ADD COLUMN {name} {ddl}"))

        rows = await conn.execute(sql_text("PRAGMA table_info(users)"))
        user_cols = {row[1] for row in rows.fetchall()}
        user_adds = {
            "ai_avatar": "TEXT DEFAULT ''",
            "ai_name": "TEXT DEFAULT 'NekroAgent'",
        }
        for name, ddl in user_adds.items():
            if name not in user_cols:
                await conn.execute(sql_text(f"ALTER TABLE users ADD COLUMN {name} {ddl}"))

        # 迁移最近这版不兼容上游插件解析规则的 channel_id。
        rows = await conn.execute(
            sql_text("SELECT id, channel_id, kind, user_id FROM conversations")
        )
        for conversation_id, channel_id, kind, user_id in rows.fetchall():
            owner_user_id = user_id or "anon"
            normalized = _normalize_channel_id(channel_id, kind or "direct", owner_user_id)
            if normalized != channel_id:
                await conn.execute(
                    sql_text(
                        """
                        UPDATE conversations
                        SET channel_id = :normalized
                        WHERE id = :conversation_id
                        """
                    ),
                    {"normalized": normalized, "conversation_id": conversation_id},
                )

        # 清理历史重复成员，避免权限检查被旧脏数据打爆。
        dup_rows = await conn.execute(
            sql_text(
                """
                SELECT conversation_id, user_id, MIN(id) AS keep_id
                FROM conversation_members
                GROUP BY conversation_id, user_id
                HAVING COUNT(*) > 1
                """
            )
        )
        for conversation_id, user_id, keep_id in dup_rows.fetchall():
            await conn.execute(
                sql_text(
                    """
                    DELETE FROM conversation_members
                    WHERE conversation_id = :conversation_id
                      AND user_id = :user_id
                      AND id != :keep_id
                    """
                ),
                {
                    "conversation_id": conversation_id,
                    "user_id": user_id,
                    "keep_id": keep_id,
                },
            )


async def init_db() -> None:
    async with engine.begin() as conn:
        try:
            # 探测现有表主键类型
            rows = await conn.execute(sql_text("PRAGMA table_info(conversations)"))
            info = rows.fetchall()
            if info:
                for row in info:
                    if row[1] == "id" and "INT" in str(row[2]).upper():
                        # 旧版使用的是 INT 主键，执行数据表重建
                        await conn.run_sync(Base.metadata.drop_all)
                        break
        except Exception:
            pass

        await conn.run_sync(Base.metadata.create_all)
    await _ensure_columns()


async def get_or_create_conversation(
    session: AsyncSession,
    *,
    channel_id: str,
    channel_name: str | None = None,
    kind: str = "direct",
) -> Conversation:
    result = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
    conversation = result.scalar_one_or_none()
    if conversation:
        if channel_name:
            conversation.channel_name = channel_name
        conversation.ai_name = conversation.ai_name or settings.webchat_bot_name
        conversation.kind = conversation.kind or kind
        conversation.updated_at = datetime.utcnow()
        return conversation

    conversation = Conversation(
        channel_id=channel_id,
        channel_name=channel_name or channel_id,
        kind=kind,
        user_id="",
        user_name="",
        user_avatar="",
        ai_name=settings.webchat_bot_name,
        ai_avatar="",
        invite_key=new_invite_key(),
    )
    session.add(conversation)
    await session.flush()
    return conversation


async def create_conversation(
    channel_name: str,
    user_id: str | None = None,
    user_name: str | None = None,
    channel_id: str | None = None,
    kind: str = "direct",
) -> Conversation:
    if channel_id is None:
        if kind == "group":
            channel_id = f"group_{uuid.uuid4().hex}"
        else:
            channel_id = f"direct_{uuid.uuid4().hex}"
    async with SessionLocal() as session:
        conversation = Conversation(
            channel_id=channel_id,
            channel_name=channel_name.strip() or ("新群聊" if kind == "group" else "新对话"),
            kind=kind,
            user_id=user_id if user_id else settings.webchat_user_id,
            user_name=user_name if user_name else settings.webchat_user_name,
            user_avatar="",
            ai_name=settings.webchat_bot_name,
            ai_avatar="",
            invite_key=new_invite_key(),
        )
        session.add(conversation)
        await session.commit()
        await session.refresh(conversation)
        return conversation


async def get_or_create_user_default_conversation(
    *,
    user_id: str,
    user_name: str,
) -> Conversation:
    channel_id = user_chatkey(user_id)
    async with SessionLocal() as session:
        result = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        conversation = result.scalar_one_or_none()
        if conversation:
            conversation.user_id = user_id
            conversation.user_name = user_name
            conversation.ai_name = conversation.ai_name or settings.webchat_bot_name
            conversation.invite_key = conversation.invite_key or new_invite_key()
            await session.commit()
            await session.refresh(conversation)
            return conversation

        conversation = Conversation(
            channel_id=channel_id,
            channel_name="默认对话",
            kind="direct",
            user_id=user_id,
            user_name=user_name,
            user_avatar="",
            ai_name=settings.webchat_bot_name,
            ai_avatar="",
            invite_key=new_invite_key(),
        )
        session.add(conversation)
        await session.commit()
        await session.refresh(conversation)
        return conversation


async def list_conversations(include_deprecated: bool = False) -> list[Conversation]:
    async with SessionLocal() as session:
        stmt = select(Conversation).order_by(Conversation.updated_at.desc())
        if not include_deprecated:
            stmt = stmt.where(Conversation.channel_id != settings.webchat_channel_id)
            stmt = stmt.where(Conversation.user_id != settings.webchat_user_id)
            stmt = stmt.where(Conversation.user_id != "")
        result = await session.execute(stmt)
        return list(result.scalars().all())


async def list_user_conversations(user_id: str) -> list[Conversation]:
    async with SessionLocal() as session:
        member_ids = select(ConversationMember.conversation_id).where(ConversationMember.user_id == user_id)
        stmt = (
            select(Conversation)
            .where(or_(Conversation.user_id == user_id, Conversation.id.in_(member_ids)))
            .order_by(Conversation.updated_at.desc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())


async def get_conversation(channel_id: str) -> Conversation | None:
    async with SessionLocal() as session:
        result = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        return result.scalar_one_or_none()


async def user_can_access_conversation(channel_id: str, user_id: str) -> bool:
    async with SessionLocal() as session:
        result = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        conversation = result.scalar_one_or_none()
        if not conversation:
            return False
        if conversation.user_id == user_id:
            return True
        if conversation.kind != "group":
            return False
        member = await session.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation.id,
                ConversationMember.user_id == user_id,
            )
        )
        return member.scalars().first() is not None


async def ensure_conversation_invite_key(channel_id: str) -> Conversation | None:
    async with SessionLocal() as session:
        result = await session.execute(select(Conversation).where(Conversation.channel_id == channel_id))
        conversation = result.scalar_one_or_none()
        if not conversation:
            return None
        if conversation.kind != "group":
            return None
        if not conversation.invite_key:
            conversation.invite_key = new_invite_key()
            await session.commit()
            await session.refresh(conversation)
        return conversation


async def join_conversation_by_invite_key(
    *,
    invite_key: str,
    user_id: str,
    user_name: str,
) -> Conversation | None:
    async with SessionLocal() as session:
        result = await session.execute(select(Conversation).where(Conversation.invite_key == invite_key))
        conversation = result.scalar_one_or_none()
        if not conversation:
            return None
        if conversation.kind != "group":
            return None
        if conversation.user_id == user_id:
            return conversation

        existing = await session.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation.id,
                ConversationMember.user_id == user_id,
            )
        )
        existing_member = existing.scalars().first()
        if existing_member is None:
            from sqlalchemy.exc import IntegrityError
            try:
                session.add(
                    ConversationMember(
                        conversation_id=conversation.id,
                        user_id=user_id,
                        user_name=user_name,
                    )
                )
                await session.commit()
            except IntegrityError:
                await session.rollback()
        else:
            await session.execute(
                delete(ConversationMember).where(
                    ConversationMember.conversation_id == conversation.id,
                    ConversationMember.user_id == user_id,
                    ConversationMember.id != existing_member.id,
                )
            )
            await session.commit()
        await session.refresh(conversation)
        return conversation


async def update_conversation_profile(
    channel_id: str,
    values: dict[str, str],
) -> Conversation | None:
    async with SessionLocal() as session:
        conversation = await get_or_create_conversation(
            session,
            channel_id=channel_id,
            channel_name=values.get("channel_name"),
        )
        for key in ("channel_name", "user_name", "user_avatar", "ai_name", "ai_avatar"):
            if key in values:
                setattr(conversation, key, values[key].strip())
        conversation.updated_at = datetime.utcnow()
        await session.commit()
        await session.refresh(conversation)
        return conversation


async def save_message(
    *,
    channel_id: str,
    role: Literal["user", "assistant", "system"],
    message_id: str,
    sender_id: str,
    sender_name: str,
    content: str = "",
    file_url: str = "",
    file_name: str = "",
    mime_type: str = "",
    file_size: int = 0,
) -> ChatMessage:
    async with SessionLocal() as session:
        conversation = await get_or_create_conversation(session, channel_id=channel_id)
        message = ChatMessage(
            conversation_id=conversation.id,
            message_id=message_id,
            role=role,
            sender_id=sender_id,
            sender_name=sender_name,
            content=content,
            file_url=file_url,
            file_name=file_name,
            mime_type=mime_type,
            file_size=file_size,
        )
        conversation.updated_at = datetime.utcnow()
        session.add(message)
        await session.commit()
        await session.refresh(message)
        return message


async def list_recent_messages(channel_id: str, before_id: int | None = None, limit: int = 50) -> list[ChatMessage]:
    async with SessionLocal() as session:
        conversation = await get_or_create_conversation(session, channel_id=channel_id)
        stmt = select(ChatMessage).where(ChatMessage.conversation_id == conversation.id)
        if before_id is not None:
            stmt = stmt.where(ChatMessage.id < before_id)
        stmt = stmt.order_by(ChatMessage.id.desc()).limit(limit)
        result = await session.execute(stmt)
        return list(reversed(result.scalars().all()))


def conversation_to_dict(conversation: Conversation) -> dict[str, Any]:
    return {
        "id": conversation.id,
        "channel_id": conversation.channel_id,
        "channel_name": conversation.channel_name,
        "kind": conversation.kind,
        "user_id": conversation.user_id,
        "user_name": conversation.user_name,
        "user_avatar": conversation.user_avatar,
        "ai_name": conversation.ai_name,
        "ai_avatar": conversation.ai_avatar,
        "invite_key": conversation.invite_key,
        "channel_avatar": conversation.channel_avatar if hasattr(conversation, "channel_avatar") else "",
        "updated_at": int(conversation.updated_at.timestamp()),
    }
