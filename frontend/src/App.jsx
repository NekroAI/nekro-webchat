import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { FileText, FileCode, FileSpreadsheet, Presentation, Archive, Download, X, Eye, LogOut, ArrowLeft, MessageSquarePlus, UsersRound, Settings, Save, UserPlus, Send, UploadCloud, Trash2, SmilePlus } from 'lucide-react'
import 'katex/dist/katex.min.css'
import ReactMarkdown from 'react-markdown'
import mermaid from 'mermaid'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import remarkDeflist from 'remark-deflist'
import remarkMath from 'remark-math'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { aiAvatar, stickers, userAvatar } from './assets'
import { authFetch, getToken, getWsBaseUrl, clearAuth, saveAuth, withApiBase } from './auth'

mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'neutral',
})

function getStickerContent(name) {
  return `[表情包] ${name}`
}

function getStickerNameFromContent(content = '') {
  const text = String(content).trim()
  if (!text.startsWith('[表情包]')) return ''
  return text.replace(/^\[表情包\]\s*/, '').trim()
}

function resolveBackendAssetUrl(url) {
  if (!url) return url
  if (/^(https?:)?\/\//i.test(url) || url.startsWith('data:') || url.startsWith('blob:')) {
    return url
  }
  if (url.startsWith('/api/') || url.startsWith('/data/') || url.startsWith('/uploads/')) {
    return withApiBase(url)
  }
  return url
}

function getFileExtension(fileName = '', fileUrl = '') {
  const source = fileName || fileUrl
  const cleanSource = String(source).split('?')[0]
  const parts = cleanSource.split('.')
  return parts.length > 1 ? parts.pop().toLowerCase() : ''
}

function isImageAttachment(msg) {
  const mimeType = String(msg?.mime_type || '')
  if (mimeType.startsWith('image/')) return true
  const ext = getFileExtension(msg?.file_name, msg?.file_url)
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'].includes(ext)
}

function getStickerByName(name) {
  return stickers.find((sticker) => sticker.name === name) || null
}

const markdownSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames || []), 'svg', 'path', 'g', 'circle', 'ellipse', 'line', 'marker', 'polygon', 'polyline', 'rect', 'text', 'tspan', 'defs', 'foreignObject', 'style', 'br', 'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'msup', 'msub', 'mfrac', 'msqrt', 'mspace', 'annotation'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'style', 'align'],
    a: [...(defaultSchema.attributes?.a || []), 'target', 'rel'],
    code: [...(defaultSchema.attributes?.code || []), 'className'],
    div: [...(defaultSchema.attributes?.div || []), 'className'],
    span: [...(defaultSchema.attributes?.span || []), 'className'],
    svg: ['xmlns', 'width', 'height', 'viewBox', 'role', 'aria-labelledby', 'aria-roledescription', 'className', 'style'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'marker-end', 'marker-start', 'className', 'style'],
    g: ['transform', 'className', 'style'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'className', 'style'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'className', 'style'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'marker-end', 'marker-start', 'className', 'style'],
    marker: ['id', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient', 'className', 'style'],
    polygon: ['points', 'fill', 'stroke', 'className', 'style'],
    polyline: ['points', 'fill', 'stroke', 'className', 'style'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'className', 'style'],
    text: ['x', 'y', 'dx', 'dy', 'fill', 'text-anchor', 'dominant-baseline', 'font-size', 'font-family', 'className', 'style'],
    tspan: ['x', 'y', 'dx', 'dy', 'className', 'style'],
    foreignObject: ['x', 'y', 'width', 'height', 'className', 'style'],
    style: ['type'],
    math: ['xmlns', 'display', 'className', 'style'],
    semantics: ['className', 'style'],
    mrow: ['className', 'style'],
    mi: ['mathvariant', 'className', 'style'],
    mn: ['className', 'style'],
    mo: ['stretchy', 'fence', 'separator', 'className', 'style'],
    msup: ['className', 'style'],
    msub: ['className', 'style'],
    mfrac: ['linethickness', 'className', 'style'],
    msqrt: ['className', 'style'],
    mspace: ['width', 'height', 'depth', 'className', 'style'],
    annotation: ['encoding', 'className', 'style'],
  },
}

function MarkdownAlert({ type = 'note', title, children }) {
  return (
    <div className={`markdown-alert markdown-alert-${type}`}>
      <div className="markdown-alert-title">{title}</div>
      <div className="markdown-alert-body">{children}</div>
    </div>
  )
}

function MermaidBlock({ chart }) {
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function renderChart() {
      try {
        const id = `mermaid-${Math.random().toString(36).slice(2)}`
        const { svg: renderedSvg } = await mermaid.render(id, chart)
        if (!cancelled) {
          setSvg(renderedSvg)
          setError('')
        }
      } catch (err) {
        if (!cancelled) {
          setSvg('')
          setError(err instanceof Error ? err.message : 'Mermaid 渲染失败')
        }
      }
    }
    renderChart()
    return () => {
      cancelled = true
    }
  }, [chart])

  if (error) {
    return (
      <div className="markdown-mermaid-error">
        <div>Mermaid 渲染失败</div>
        <pre>{error}</pre>
      </div>
    )
  }

  if (!svg) {
    return <div className="markdown-mermaid-loading">Mermaid 渲染中...</div>
  }

  return <div className="markdown-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />
}

function MarkdownRenderer({ content }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks, remarkMath, remarkDeflist]}
      rehypePlugins={[[rehypeRaw], [rehypeKatex], [rehypeSanitize, markdownSchema]]}
      components={{
        a({ href, children, ...props }) {
          return (
            <a href={href} target="_blank" rel="noreferrer" {...props}>
              {children}
            </a>
          )
        },
        code({ inline, className, children, ...props }) {
          const value = String(children).replace(/\n$/, '')
          const match = /language-(\w+)/.exec(className || '')
          const language = match?.[1]?.toLowerCase()

          if (!inline && language === 'mermaid') {
            return <MermaidBlock chart={value} />
          }

          if (!inline) {
            return (
              <SyntaxHighlighter
                language={language || 'text'}
                style={atomDark}
                customStyle={{ margin: 0, borderRadius: '8px', padding: '16px' }}
                PreTag="div"
                {...props}
              >
                {value}
              </SyntaxHighlighter>
            )
          }

          return (
            <code className={className} {...props}>
              {children}
            </code>
          )
        },
        blockquote({ children }) {
          const childArray = React.Children.toArray(children)
          const firstChild = childArray[0]
          if (React.isValidElement(firstChild) && firstChild.type === 'p') {
            const paragraphChildren = React.Children.toArray(firstChild.props.children)
            const firstText = paragraphChildren[0]
            if (typeof firstText === 'string') {
              const match = firstText.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/i)
              if (match) {
                const alertType = match[1].toLowerCase()
                const titleMap = {
                  note: 'Note',
                  tip: 'Tip',
                  important: 'Important',
                  warning: 'Warning',
                  caution: 'Caution',
                }
                paragraphChildren[0] = firstText.replace(match[0], '')
                const normalizedChildren = [...childArray]
                normalizedChildren[0] = React.cloneElement(firstChild, {}, paragraphChildren)
                return (
                  <MarkdownAlert type={alertType} title={titleMap[alertType] || 'Note'}>
                    {normalizedChildren}
                  </MarkdownAlert>
                )
              }
            }
          }
          return <blockquote>{children}</blockquote>
        },
      }}
    >
      {content || ''}
    </ReactMarkdown>
  )
}

export default function App({ currentUser: initialUser, onLogout }) {
  const [currentUser, setUserState] = useState(initialUser)
  const [conversations, setConversations] = useState([])
  const [activeChannelId, setActiveChannelId] = useState('')
  const [mobileView, setMobileView] = useState('list')
  const [status, setStatus] = useState({ text: '连接中', ok: false })
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [pendingFile, setPendingFile] = useState(null)
  const [showProfile, setShowProfile] = useState(false)
  const [showUserSettings, setShowUserSettings] = useState(false)
  const [userProfileData, setUserProfileData] = useState({ display_name: '', avatar: '', ai_name: '', ai_avatar: '' })
  const [groupMembers, setGroupMembers] = useState([])
  const [isRemoving, setIsRemoving] = useState(false)
  const [showAllMembersModal, setShowAllMembersModal] = useState(false)
  const [showStickerPicker, setShowStickerPicker] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [previewImage, setPreviewImage] = useState(null)
  const [previewFile, setPreviewFile] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [notice, setNotice] = useState(null)
  const lastMessageIdRef = useRef(null)
  const [profileData, setProfileData] = useState({
    channel_name: '',
    user_name: '',
    user_avatar: '',
    ai_name: '',
    ai_avatar: ''
  })

  const socketRef = useRef(null)
  const messagesEndRef = useRef(null)
  const fileInputRef = useRef(null)
  const userAvatarRef = useRef(null)
  const aiAvatarRef = useRef(null)
  const activeChannelIdRef = useRef('')
  const isComponentMounted = useRef(true)
  const noticeTimerRef = useRef(null)
  const conversationsRefreshTimerRef = useRef(null)

  const [cropperImage, setCropperImage] = useState(null);
  const [cropperScale, setCropperScale] = useState(1);
  const [cropperOffset, setCropperOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [cropperKind, setCropperKind] = useState('user');
  const [showCropper, setShowCropper] = useState(false);

  const handleDragStart = (e) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - cropperOffset.x, y: e.clientY - cropperOffset.y });
  };

  const handleDragMove = (e) => {
    if (!isDragging) return;
    setCropperOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    });
  };

  const handleDragEnd = () => {
    setIsDragging(false);
  };

  const handleTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ 
        x: e.touches[0].clientX - cropperOffset.x, 
        y: e.touches[0].clientY - cropperOffset.y 
      });
    }
  };

  const handleTouchMove = (e) => {
    if (!isDragging || e.touches.length !== 1) return;
    setCropperOffset({
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y
    });
  };

  const handleCropperSave = () => {
    const img = new Image();
    img.onload = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 800;
      const ctx = canvas.getContext('2d');

      const ratio = 800 / 240;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 800, 800);

      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const previewW = 240;
      const previewH = 240 * (h / w);

      const finalW = previewW * cropperScale * ratio;
      const finalH = previewH * cropperScale * ratio;

      const cx = 400 + cropperOffset.x * ratio;
      const cy = 400 + cropperOffset.y * ratio;

      const dx = cx - finalW / 2;
      const dy = cy - finalH / 2;

      ctx.drawImage(img, dx, dy, finalW, finalH);

      canvas.toBlob(async (blob) => {
        if (!blob) {
          showNotice('头像生成失败', 'error');
          return;
        }
        const file = new File([blob], 'avatar.webp', { type: 'image/webp' });
        
        try {
          if (cropperKind === 'user' || cropperKind === 'ai') {
            const formData = new FormData();
            formData.append('file_data', file);
            const res = await authFetch(`/api/auth/upload/avatar?kind=${cropperKind}`, { method: 'POST', body: formData });
            if (!res.ok) throw new Error('上传头像失败');
            const data = await res.json();
            setUserProfileData(prev => ({ ...prev, [cropperKind === 'user' ? 'avatar' : 'ai_avatar']: data.file_url }));
            showNotice(`${cropperKind === 'user' ? '用户' : 'AI'}头像上传成功`, 'success');
          } else if (cropperKind === 'conv_user' || cropperKind === 'conv_ai') {
            const data = await uploadFile(file);
            if (cropperKind === 'conv_user') {
              setProfileData(prev => ({ ...prev, user_avatar: data.file_url }));
            } else {
              setProfileData(prev => ({ ...prev, ai_avatar: data.file_url }));
            }
            showNotice('对话头像裁剪成功', 'success');
          } else if (cropperKind === 'channel_avatar') {
            const formData = new FormData();
            formData.append('file_data', file);
            const res = await authFetch(`/api/conversations/${activeChannelId}/avatar`, { method: 'POST', body: formData });
            if (!res.ok) throw new Error('上传频道头像失败');
            const data = await res.json();
            
            setConversations(prev => prev.map(c => c.channel_id === activeChannelId ? { ...c, channel_avatar: data.channel_avatar } : c));
            showNotice('频道头像上传成功', 'success');
          }
          setShowCropper(false);
        } catch (err) {
          showNotice(err.message || '上传头像失败', 'error');
        }
      }, 'image/webp', 0.85);
    };
    img.src = cropperImage;
  };

  const activeConv = conversations.find(c => c.channel_id === activeChannelId)
  const isGroupChat = activeConv?.kind === 'group'

  useEffect(() => {
    activeChannelIdRef.current = activeChannelId
    setIsWaiting(false) // 切换对话时重置等待状态
  }, [activeChannelId])



  useEffect(() => {
    isComponentMounted.current = true
    fetchConversations()
    joinFromInviteUrl()
    connectWebSocket()
    return () => {
      isComponentMounted.current = false
      window.clearTimeout(noticeTimerRef.current)
      window.clearTimeout(conversationsRefreshTimerRef.current)
      if (socketRef.current) socketRef.current.close()
    }
  }, [])

  useEffect(() => {
    if (activeConv) {
      setProfileData({
        channel_name: activeConv.channel_name || '',
        user_name: activeConv.user_name || '',
        user_avatar: activeConv.user_avatar || '',
        ai_name: activeConv.ai_name || '',
        ai_avatar: activeConv.ai_avatar || ''
      })
    }
  }, [activeChannelId, conversations])

  useEffect(() => {
    setHasMore(true)
  }, [activeChannelId])

  useEffect(() => {
    if (showProfile && activeChannelId && isGroupChat) {
      fetchGroupMembers()
    }
  }, [showProfile, activeChannelId, isGroupChat])

  const fetchGroupMembers = async () => {
    try {
      const res = await authFetch(`/api/conversations/${activeChannelId}/members`)
      if (res.ok) {
        const data = await res.json()
        setGroupMembers(data)
      }
    } catch (err) {
      console.error('拉取群成员失败:', err)
    }
  }

  useEffect(() => {
    const lastMsg = messages[messages.length - 1]
    if (lastMsg && lastMsg.id !== lastMessageIdRef.current) {
      lastMessageIdRef.current = lastMsg.id
      scrollToBottom()
    } else if (isWaiting) {
      scrollToBottom()
    }
  }, [messages, isWaiting])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const showNotice = (message, level = 'warning') => {
    setNotice({ message, level })
    window.clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), 5000)
  }

  const isAiMentioned = (content) => {
    if (!isGroupChat) return true
    const names = new Set(['AI', 'NekroAgent'])
    if (activeConv?.ai_name) names.add(activeConv.ai_name)
    return Array.from(names).some(name => content.toLowerCase().includes(`@${name}`.toLowerCase()))
  }

  const handleScroll = async (e) => {
    const { scrollTop } = e.currentTarget
    if (scrollTop === 0 && messages.length > 0 && hasMore) {
      const container = e.currentTarget
      const previousHeight = container.scrollHeight
      const oldestMsg = messages.find(m => typeof m.id === 'number') || messages[0]
      if (!oldestMsg || !oldestMsg.id) return

      try {
        const res = await authFetch(`/api/conversations/${activeChannelId}/messages?before_id=${oldestMsg.id}&limit=50`)
        const data = await res.json()
        if (data.items && data.items.length > 0) {
          setMessages(prev => {
            const newItems = data.items.filter(item => !prev.some(p => p.id === item.id))
            return [...newItems, ...prev]
          })
          if (data.items.length < 50) {
            setHasMore(false)
          }
          setTimeout(() => {
            if (container) {
              container.scrollTop = container.scrollHeight - previousHeight
            }
          }, 0)
        } else {
          setHasMore(false)
        }
      } catch (err) {
        console.error('加载历史消息失败:', err)
      }
    }
  }

  const fetchConversations = async () => {
    try {
      const res = await authFetch('/api/conversations')
      const data = await res.json()
      const items = data.items || []
      setConversations(items)
      if (items.length && !activeChannelIdRef.current) {
        // 留空，待用户点击
      }
    } catch (err) {
      console.error('获取对话列表失败:', err)
    }
  }

  const joinFromInviteUrl = async () => {
    const hashMatch = window.location.hash.match(/^#\/invite\/([^/]+)$/)
    const pathMatch = window.location.pathname.match(/^\/invite\/([^/]+)$/)
    const match = hashMatch || pathMatch
    if (!match) return
    const inviteKey = decodeURIComponent(match[1])
    try {
      const res = await authFetch(`/api/invite/${encodeURIComponent(inviteKey)}/join`, { method: 'POST' })
      const item = await res.json()
      if (!res.ok) throw new Error(item.detail || '加入群聊失败')
      setConversations(prev => {
        if (prev.some(conv => conv.channel_id === item.channel_id)) {
          return prev.map(conv => conv.channel_id === item.channel_id ? item : conv)
        }
        return [item, ...prev]
      })
      selectConversation(item.channel_id)
      showNotice(`已加入「${item.channel_name}」`, 'success')
      window.history.replaceState({}, '', window.location.pathname)
    } catch (err) {
      showNotice(err.message || '加入群聊失败', 'error')
    }
  }

  const scheduleFetchConversations = () => {
    window.clearTimeout(conversationsRefreshTimerRef.current)
    conversationsRefreshTimerRef.current = window.setTimeout(() => {
      if (isComponentMounted.current) fetchConversations()
    }, 250)
  }

  const connectWebSocket = () => {
    const token = getToken()
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const host = window.location.host
    const wsBaseUrl = getWsBaseUrl()
    const wsOrigin = wsBaseUrl || `${protocol}://${host}`
    const wsUrl = `${wsOrigin}/ws?token=${encodeURIComponent(token)}`

    const ws = new WebSocket(wsUrl)
    socketRef.current = ws

    ws.onopen = () => {
      if (!isComponentMounted.current) {
        ws.close()
        return
      }
      setStatus({ text: '在线', ok: true })
      if (activeChannelIdRef.current) {
        ws.send(JSON.stringify({ action: 'select', channel_id: activeChannelIdRef.current }))
      }
    }

    ws.onclose = () => {
      if (!isComponentMounted.current) return
      setStatus({ text: '离线', ok: false })
      setTimeout(() => {
        if (isComponentMounted.current) connectWebSocket()
      }, 1200)
    }

    ws.onmessage = (event) => {
      if (!isComponentMounted.current) return
      const payload = JSON.parse(event.data)
      if (payload.type === 'message') {
        if (!activeChannelIdRef.current || payload.channel_id === activeChannelIdRef.current || !payload.channel_id) {
          setMessages(prev => {
            if (prev.some(m => m.id === payload.id)) return prev
            return [...prev, payload]
          })
          if (payload.role !== 'user') {
            setIsWaiting(false)
          }
        }
        scheduleFetchConversations()
      } else if (payload.type === 'history') {
        if (!activeChannelIdRef.current || (payload.channel_id && activeChannelIdRef.current !== payload.channel_id)) {
          return
        }
        setMessages(payload.items || [])
        setIsWaiting(false)
      } else if (payload.type === 'conversations') {
        const items = payload.items || []
        setConversations(items)
        // 不再默认自动选中第一个对话
        if (items.length && !activeChannelIdRef.current) {
          // 留空，等待用户手动点击
        }
      } else if (payload.type === 'status') {
        setStatus({ text: payload.connected ? '在线' : '连接中', ok: payload.connected })
      } else if (payload.type === 'error') {
        showNotice(payload.message || '操作失败', 'error')
        setMessages(prev => [...prev, { role: 'system', content: payload.message }])
        setIsWaiting(false)
      } else if (payload.type === 'notification') {
        if (!payload.channel_id || payload.channel_id === activeChannelIdRef.current) {
          showNotice(payload.message || '操作被系统拦截', payload.level || 'warning')
        }
        setIsWaiting(false)
      }
    }
  }

  const selectConversation = (channelId) => {
    activeChannelIdRef.current = channelId
    setActiveChannelId(channelId)
    setMobileView('chat')
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ action: 'select', channel_id: channelId }))
    }
  }

  const createNewChat = async () => {
    const name = prompt('对话名称', '新对话')
    if (name === null) return
    try {
      const res = await authFetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_name: name }),
      })
      const item = await res.json()
      setConversations(prev => [item, ...prev])
      selectConversation(item.channel_id)
    } catch (err) {
      showNotice(err.message || '创建对话失败', 'error')
      console.error('创建对话失败:', err)
    }
  }

  const createGroupChat = async () => {
    const name = prompt('群聊名称', '新群聊')
    if (name === null) return
    try {
      const res = await authFetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_name: name }),
      })
      const item = await res.json()
      if (!res.ok) throw new Error(item.detail || '创建群聊失败')
      setConversations(prev => [item, ...prev])
      selectConversation(item.channel_id)
      showNotice(`已创建群聊「${item.channel_name}」`, 'success')
    } catch (err) {
      showNotice(err.message || '创建群聊失败', 'error')
      console.error('创建群聊失败:', err)
    }
  }

  const copyInviteLink = async () => {
    if (!activeChannelId) return
    try {
      const res = await authFetch(`/api/conversations/${activeChannelId}/invite`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || '获取邀请链接失败')
      const inviteUrl = `${window.location.origin}/#${data.invite_path}`
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({
            title: `加入群聊「${activeConv?.channel_name || 'WebChat'}」`,
            text: `点击链接加入群聊「${activeConv?.channel_name || 'WebChat'}」`,
            url: inviteUrl,
          });
          showNotice('分享菜单已拉起', 'success');
          return;
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') return;
        }
      }
      await navigator.clipboard.writeText(inviteUrl)
      showNotice('群聊邀请链接已复制', 'success')
    } catch (err) {
      showNotice(err.message || '复制群聊邀请链接失败', 'error')
    }
  }

  const openUserSettings = () => {
    setUserProfileData({
      display_name: currentUser?.display_name || currentUser?.username || '',
      avatar: currentUser?.avatar || '',
      ai_name: currentUser?.ai_name || '',
      ai_avatar: currentUser?.ai_avatar || ''
    });
    setShowUserSettings(true);
  };

  const uploadUserAvatar_OLD = async (kind) => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const formData = new FormData();
        formData.append('file_data', file);
        const res = await authFetch(`/api/auth/upload/avatar?kind=${kind}`, { method: 'POST', body: formData });
        if (!res.ok) throw new Error('上传头像失败');
        const data = await res.json();
        setUserProfileData(prev => ({ ...prev, [kind === 'user' ? 'avatar' : 'ai_avatar']: data.file_url }));
        showNotice(`${kind === 'user' ? '用户' : 'AI'}头像上传成功`, 'success');
      } catch (err) {
        showNotice(err.message || '上传头像失败', 'error');
      }
    };
    fileInput.click();
  };

  const uploadUserAvatar = (kind) => {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
        setCropperImage(event.target.result);
        setCropperKind(kind);
        setCropperScale(1);
        setCropperOffset({ x: 0, y: 0 });
        setShowCropper(true);
      };
      reader.readAsDataURL(file);
    };
    fileInput.click();
  };

  const saveUserSettings = async () => {
    try {
      const res = await authFetch('/api/auth/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userProfileData),
      });
      const updatedUser = await res.json();
      if (!res.ok) throw new Error(updatedUser.detail || '保存个人信息失败');

      showNotice('个人信息已保存', 'success');
      setShowUserSettings(false);
      saveAuth(getToken(), updatedUser);
      setUserState(updatedUser);
    } catch (err) {
      showNotice(err.message || '保存个人信息失败', 'error');
    }
  };

  const removeMember = async (uid) => {
    try {
      const res = await authFetch(`/api/conversations/${activeChannelId}/members/${uid}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '移出群成员失败');

      showNotice('已成功移出群成员', 'success');
      setGroupMembers(prev => prev.filter(m => m.user_id !== uid));
    } catch (err) {
      showNotice(err.message || '移出群成员失败', 'error');
    }
  }

  const deleteConversation = async (channelId, e) => {
    if (e) e.stopPropagation();
    if (!window.confirm('确定要彻底删除该对话吗？删除后将清除全部聊天记录。')) return;
    try {
      const res = await authFetch(`/api/conversations/${channelId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || '删除对话失败');
      }
      showNotice('对话已删除', 'success');
      setConversations(prev => prev.filter(item => item.channel_id !== channelId));
      if (activeChannelId === channelId) {
        setActiveChannelId('');
      }
    } catch (err) {
      showNotice(err.message || '删除对话失败', 'error');
    }
  };

  const saveProfileSettings = async () => {
    if (!activeChannelId) return
    try {
      const res = await authFetch(`/api/conversations/${activeChannelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileData),
      })
      const updated = await res.json()
      setConversations(prev => prev.map(item => item.channel_id === updated.channel_id ? updated : item))
      setShowProfile(false)
    } catch (err) {
      console.error('保存设置失败:', err)
    }
  }

  const exitGroupChat = async () => {
    if (!activeChannelId) return;
    if (!window.confirm('确定要退出该群聊吗？')) return;
    try {
      const res = await authFetch(`/api/conversations/${activeChannelId}/leave`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || '退出群聊失败');

      showNotice('已成功退出群聊', 'success');
      setConversations(prev => prev.filter(item => item.channel_id !== activeChannelId));
      setActiveChannelId('');
      setShowProfile(false);
    } catch (err) {
      showNotice(err.message || '退出群聊失败', 'error');
    }
  }

  const handleFileChange = (e) => {
    setPendingFile(e.target.files[0] || null)
  }

  const uploadFile = async (file) => {
    const formData = new FormData()
    formData.append('file_data', file)
    if (activeChannelId) {
      formData.append('channel_id', activeChannelId)
    }
    const res = await authFetch('/api/upload', { method: 'POST', body: formData })
    if (!res.ok) {
      let message = '上传失败'
      try {
        const data = await res.json()
        message = data.detail || message
      } catch (err) { }
      throw new Error(message)
    }
    return await res.json()
  }

  const handleAvatarUpload_OLD = async (e, type) => {
    const file = e.target.files[0]
    if (!file) return
    try {
      const data = await uploadFile(file)
      if (type === 'user') {
        setProfileData(prev => ({ ...prev, user_avatar: data.file_url }))
      } else {
        setProfileData(prev => ({ ...prev, ai_avatar: data.file_url }))
      }
    } catch (err) {
      showNotice(err.message || '上传头像失败', 'error')
      console.error('上传头像失败:', err)
    }
  }

  const handleAvatarUpload = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      setCropperImage(event.target.result);
      setCropperKind(type === 'user' ? 'conv_user' : 'conv_ai');
      setCropperScale(1);
      setCropperOffset({ x: 0, y: 0 });
      setShowCropper(true);
    };
    reader.readAsDataURL(file);
  };

  const sendSticker = async (sticker) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN || !activeChannelId) return
    try {
      const content = getStickerContent(sticker.name)
      const shouldWaitForAi = isAiMentioned(content)
      setIsWaiting(shouldWaitForAi)
      socketRef.current.send(JSON.stringify({
        action: 'send',
        channel_id: activeChannelId,
        content,
        file: null,
      }))
      setShowStickerPicker(false)
    } catch (err) {
      setIsWaiting(false)
      showNotice(err.message || '发送表情包失败', 'error')
    }
  }

  const handleSend = async (e) => {
    e.preventDefault()
    const content = input.trim()
    if ((!content && !pendingFile) || socketRef.current?.readyState !== WebSocket.OPEN || !activeChannelId) return

    try {
      const shouldWaitForAi = isAiMentioned(content)
      setIsWaiting(shouldWaitForAi)
      let fileInfo = null
      if (pendingFile) {
        fileInfo = await uploadFile(pendingFile)
      }

      socketRef.current.send(JSON.stringify({
        action: 'send',
        channel_id: activeChannelId,
        content,
        file: fileInfo,
      }))

      setInput('')
      setPendingFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setIsWaiting(false)
      showNotice(err.message || '发送消息失败', 'error')
      console.error('发送消息失败:', err)
    }
  }

  const getFileIcon = (fileName) => {
    const ext = (fileName || '').split('.').pop().toLowerCase()
    if (['html', 'js', 'css', 'json', 'py', 'java', 'cpp', 'md', 'ts'].includes(ext)) return <FileCode size={20} />
    if (['txt', 'log'].includes(ext)) return <FileText size={20} />
    if (['doc', 'docx'].includes(ext)) return <FileText size={20} />
    if (['xls', 'xlsx', 'csv'].includes(ext)) return <FileSpreadsheet size={20} />
    if (['ppt', 'pptx'].includes(ext)) return <Presentation size={20} />
    if (ext === 'pdf') return <FileText size={20} />
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return <Archive size={20} />
    return <FileText size={20} />
  }
  const getFileClass = (fileName) => {
    const ext = (fileName || '').split('.').pop().toLowerCase()
    if (['html', 'js', 'css', 'json', 'py', 'java', 'cpp', 'md', 'ts'].includes(ext)) return 'icon-code'
    if (['txt', 'log'].includes(ext)) return 'icon-txt'
    if (['doc', 'docx'].includes(ext)) return 'icon-doc'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'icon-xls'
    if (['ppt', 'pptx'].includes(ext)) return 'icon-ppt'
    if (ext === 'pdf') return 'icon-pdf'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'icon-zip'
    return ''
  }
  const getFileSubtitle = (fileName, mimeType) => {
    const ext = (fileName || '').split('.').pop().toLowerCase()
    if (['txt', 'log'].includes(ext)) return 'Text · 文本文件'
    if (['doc', 'docx'].includes(ext)) return 'Word · 文档'
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'Excel · 表格'
    if (['ppt', 'pptx'].includes(ext)) return 'PowerPoint · 演示文稿'
    if (ext === 'pdf') return 'PDF · 便携式文档'
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'Archive · 压缩包'
    if (['html', 'js', 'css', 'json', 'py', 'java', 'cpp', 'md', 'ts'].includes(ext)) return 'Code · 源文件'
    return mimeType || '未知类型'
  }

  const isTextFile = (name) => {
    if (!name) return false
    const ext = name.split('.').pop().toLowerCase()
    return ['md', 'html', 'txt', 'json', 'js', 'ts', 'jsx', 'css', 'py', 'yaml', 'yml', 'xml', 'log'].includes(ext)
  }

  const handlePreviewFile = async (name, url) => {
    try {
      const res = await fetch(withApiBase(url))
      if (!res.ok) {
        if (res.status === 404) {
          alert('文件已过期或被系统自动清理')
        } else {
          alert('无法加载文件内容')
        }
        return
      }
      const content = await res.text()
      const ext = name.split('.').pop().toLowerCase()
      let type = 'text'
      if (ext === 'md') type = 'md'
      else if (ext === 'html') type = 'html'
      setPreviewFile({ name, url: withApiBase(url), content, type })
    } catch (err) {
      console.error('预览文件失败:', err)
      alert('无法加载文件内容')
    }
  }

  return (
    <main className={`shell mobile-view-${mobileView}`}>
      <aside className="sidebar">
        <div className="profile user-profile-top">
          <div className="user-avatar-wrapper" onClick={openUserSettings} title="点击修改个人信息">
            <div className="avatar">
              <img src={resolveBackendAssetUrl(currentUser?.avatar) || userAvatar} alt="User Avatar" />
            </div>
            <div className="user-info-card">
              <div className="card-header">个人资料</div>
              <div className="card-row"><span className="label">UID</span> <span className="value">{currentUser?.id || '-'}</span></div>
              <div className="card-row"><span className="label">账号</span> <span className="value">{currentUser?.username || '-'}</span></div>
              <div className="card-row"><span className="label">昵称</span> <span className="value">{currentUser?.display_name || '-'}</span></div>
            </div>
          </div>
          <div className="profile-info">
            <div className="name">{currentUser?.display_name || currentUser?.username}</div>
            <div className={`status ${status.ok ? 'online' : 'offline'}`}>{status.text}</div>
          </div>
          <button className="logout-button-icon top-logout" type="button" onClick={() => { clearAuth(); onLogout() }} title="退出登录">
            <LogOut size={20} />
          </button>
        </div>

        <div className="new-chat-actions">
          <button className="new-chat-icon-btn" type="button" onClick={createNewChat} title="新建对话">
            <MessageSquarePlus size={20} />
          </button>
          <button className="new-chat-icon-btn secondary" type="button" onClick={createGroupChat} title="创建群聊">
            <UsersRound size={20} />
          </button>
        </div>

        <div className="chat-list">
          {conversations.map(item => (
            <button
              key={item.channel_id}
              className={`chat-item ${item.channel_id === activeChannelId ? 'active' : ''}`}
              onClick={() => selectConversation(item.channel_id)}
            >
              <div className="chat-avatar">
                <img src={resolveBackendAssetUrl(item.channel_avatar) || resolveBackendAssetUrl(item.ai_avatar) || aiAvatar} alt={item.ai_name} />
              </div>
              <div className="chat-meta">
                <span className="chat-title">{item.channel_name}</span>
                <span className="chat-subtitle">{item.last_message || item.channel_id}</span>
              </div>
            </button>
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-brand-name">Nekro WebChat</div>
        </div>
      </aside>

      <section className="chat">
        {notice && createPortal(
          <div className={`toast ${notice.level || 'warning'}`} role="status">
            {notice.message}
          </div>
        , document.body)}
        {activeChannelId ? (
          <div className="chat-content">
            <header className="chat-header">
              <button className="back-button-icon" onClick={() => setMobileView('list')} type="button" title="返回列表">
                <ArrowLeft size={20} />
              </button>
              <div className="chat-header-main">
                <h1>{activeConv?.channel_name || 'WebChat'}</h1>
                <p>{activeConv ? `${activeConv.ai_name || 'NekroAgent'} · ${activeConv.channel_id}` : '-'}</p>
              </div>
              <button
                className={`ghost-button-icon ${showProfile ? 'active' : ''}`}
                type="button"
                onClick={() => setShowProfile(!showProfile)}
                title={isGroupChat ? '群聊设置' : '对话设置'}
              >
                <Settings size={20} />
              </button>
            </header>

            {showProfile && (
              <section className="profile-panel">
                <div className="profile-panel-header">
                  <button className="close-panel-btn" onClick={() => setShowProfile(false)} title="返回对话" type="button">
                    <ArrowLeft size={20} />
                  </button>
                  <h2>{isGroupChat ? '群聊设置' : '对话设置'}</h2>
                  <div style={{ width: 32 }} />
                </div>

                {isGroupChat && (
                  <div className="group-members-section" style={{ padding: '0 16px 16px' }}>
                    <div className="members-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                      <h3 style={{ fontSize: '0.95rem', fontWeight: '600', color: 'var(--text-main)' }}>群聊成员</h3>
                      <span
                        style={{ fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}
                        onClick={() => setShowAllMembersModal(true)}
                      >
                        查看{groupMembers.length}名群成员 &gt;
                      </span>
                    </div>
                    <div className="members-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '12px 8px', marginBottom: '20px' }}>
                      {groupMembers.slice(0, 13).map(m => (
                        <div key={m.user_id} className="member-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', position: 'relative' }}>
                          <div className="member-avatar" style={{ width: '40px', height: '40px', borderRadius: '50%', overflow: 'hidden', border: '1px solid rgba(0,0,0,0.06)', position: 'relative' }}>
                            <img src={resolveBackendAssetUrl(m.avatar) || userAvatar} alt={m.display_name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            {isRemoving && !m.is_owner && (
                              <button
                                className="remove-member-badge"
                                type="button"
                                onClick={() => removeMember(m.user_id)}
                                style={{ position: 'absolute', top: '-2px', right: '-2px', width: '16px', height: '16px', borderRadius: '50%', background: '#ef4444', color: 'white', border: 'none', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0 }}
                              >
                                ×
                              </button>
                            )}
                          </div>
                          <span className="member-name" style={{ fontSize: '0.75rem', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '48px', textAlign: 'center' }}>{m.display_name}</span>
                        </div>
                      ))}

                      {/* 邀请 */}
                      <div className="member-item func-item" onClick={copyInviteLink} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                        <div className="func-btn plus" style={{ width: '40px', height: '40px', borderRadius: '50%', background: '#f3f4f6', border: '1px dashed #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: '#9ca3af', paddingBottom: '4px' }}>
                          +
                        </div>
                        <span className="member-name" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>邀请</span>
                      </div>

                      {/* 移除 */}
                      {activeConv?.user_id === currentUser?.id && (
                        <div
                          className={`member-item func-item ${isRemoving ? 'active' : ''}`}
                          onClick={() => setIsRemoving(!isRemoving)}
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
                        >
                          <div className="func-btn minus" style={{ width: '40px', height: '40px', borderRadius: '50%', background: isRemoving ? '#fee2e2' : '#f3f4f6', border: isRemoving ? '1px solid #fca5a5' : '1px dashed #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', color: isRemoving ? '#ef4444' : '#9ca3af', paddingBottom: '4px' }}>
                            -
                          </div>
                          <span className="member-name" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{isRemoving ? '取消' : '移出'}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div className="form-group" style={{ padding: '0 16px', marginBottom: '24px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '12px', display: 'block', fontWeight: 'bold', width: '100%', textAlign: 'left' }}>频道头像</label>
                  <div style={{ position: 'relative', width: '80px', height: '80px' }}>
                    <img 
                      src={resolveBackendAssetUrl(activeConv?.channel_avatar) || resolveBackendAssetUrl(activeConv?.ai_avatar) || aiAvatar} 
                      alt="频道头像" 
                      style={{ width: '80px', height: '80px', borderRadius: '50%', objectFit: 'cover', border: '2px solid rgba(0,0,0,0.05)' }} 
                    />
                    {(!isGroupChat || activeConv?.user_id === currentUser?.id) && (
                      <button
                        type="button"
                        onClick={() => {
                          const fileInput = document.createElement('input');
                          fileInput.type = 'file';
                          fileInput.accept = 'image/*';
                          fileInput.onchange = (e) => {
                            const file = e.target.files[0];
                            if (!file) return;
                            const reader = new FileReader();
                            reader.onload = (event) => {
                              setCropperImage(event.target.result);
                              setCropperKind('channel_avatar');
                              setCropperScale(1);
                              setCropperOffset({ x: 0, y: 0 });
                              setShowCropper(true);
                            };
                            reader.readAsDataURL(file);
                          };
                          fileInput.click();
                        }}
                        style={{ position: 'absolute', bottom: 0, right: 0, background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.2)' }}
                        title="修改频道头像"
                      >
                        <UploadCloud size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {(!isGroupChat || activeConv?.user_id === currentUser?.id) ? (
                  <div className="form-group" style={{ padding: '0 16px', marginBottom: '24px' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', fontWeight: 'bold' }}>{isGroupChat ? '群聊名称' : '对话名称'}</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input
                        style={{ flex: 1, padding: '8px 12px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 'var(--radius-sm)', fontSize: '0.9rem' }}
                        value={profileData.channel_name || ''}
                        onChange={e => setProfileData(prev => ({ ...prev, channel_name: e.target.value }))}
                      />
                      <button
                        className="save-button-icon"
                        type="button"
                        onClick={saveProfileSettings}
                        title="保存名称"
                        style={{ padding: '8px 12px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: 'var(--radius-sm)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <Save size={16} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="form-group" style={{ padding: '0 16px', marginBottom: '24px' }}>
                    <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '6px', display: 'block', fontWeight: 'bold' }}>群聊名称</label>
                    <div style={{ fontSize: '0.95rem', padding: '8px 12px', background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.05)', borderRadius: 'var(--radius-sm)', color: 'var(--text-muted)' }}>
                      {profileData.channel_name || activeConv?.channel_name}
                    </div>
                  </div>
                )}

                {isGroupChat ? (
                  <div className="panel-actions" style={{ display: 'flex', justifyContent: 'center', gap: '20px', padding: '16px' }}>
                    <button
                      className="invite-button-icon"
                      type="button"
                      onClick={copyInviteLink}
                      title="复制群聊邀请链接"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: 'var(--primary)', color: 'white', borderRadius: 'var(--radius-md)', border: 'none', cursor: 'pointer' }}
                    >
                      <UserPlus size={18} /> 邀请
                    </button>
                    {activeConv?.user_id === currentUser?.id ? (
                      <button
                        className="exit-button-icon"
                        type="button"
                        onClick={(e) => deleteConversation(activeChannelId, e)}
                        title="解散群聊"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#fee2e2', color: '#ef4444', borderRadius: 'var(--radius-md)', border: '1px solid #fca5a5', cursor: 'pointer' }}
                      >
                        <Trash2 size={18} /> 解散群聊
                      </button>
                    ) : (
                      <button
                        className="exit-button-icon"
                        type="button"
                        onClick={exitGroupChat}
                        title="退出群聊"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 16px', background: '#fee2e2', color: '#ef4444', borderRadius: 'var(--radius-md)', border: '1px solid #fca5a5', cursor: 'pointer' }}
                      >
                        <LogOut size={18} /> 退出群聊
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="panel-actions" style={{ display: 'flex', justifyContent: 'center', padding: '16px' }}>
                    <button
                      className="exit-button-icon"
                      type="button"
                      onClick={(e) => deleteConversation(activeChannelId, e)}
                      title="删除对话"
                      style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 24px', background: '#fee2e2', color: '#ef4444', borderRadius: 'var(--radius-md)', border: '1px solid #fca5a5', cursor: 'pointer' }}
                    >
                      <Trash2 size={18} /> 删除对话
                    </button>
                  </div>
                )}
              </section>
            )}

            <div className="messages" onScroll={handleScroll}>
              {messages.map((msg, index) => {
                const isOwn = msg.role === 'user' && String(msg.sender_id) === String(currentUser?.id)
                const rowRole = isOwn ? 'user' : (msg.role === 'user' ? 'other-user' : msg.role)
                const isSystem = msg.role === 'system'
                const stickerName = getStickerNameFromContent(msg.content)
                const sticker = stickerName ? getStickerByName(stickerName) : null
                const avatarUrl = isOwn
                  ? (resolveBackendAssetUrl(currentUser?.avatar) || userAvatar)
                  : (msg.role === 'user'
                    ? (resolveBackendAssetUrl(msg.sender_avatar) || userAvatar)
                    : (resolveBackendAssetUrl(activeConv?.ai_avatar) || resolveBackendAssetUrl(currentUser?.ai_avatar) || aiAvatar))
                const isStickerMessage = Boolean(sticker)
                const isImageOnly = msg.file_url && isImageAttachment(msg) &&
                  (
                    !msg.content ||
                    msg.content.trim() === `[图片] ${msg.file_name}` ||
                    msg.content.trim() === `[图片]${msg.file_name}` ||
                    isStickerMessage
                  )

                return (
                  <div key={index} className={`bubble-row ${rowRole}`}>
                    {!isSystem && (
                      <div className="msg-avatar">
                        <img src={avatarUrl} alt={msg.sender_name} />
                      </div>
                    )}
                    <div className={`bubble ${isImageOnly ? 'bubble-image-only' : ''} ${isStickerMessage ? 'bubble-sticker-only' : ''}`}>
                      {!isOwn && !isSystem && msg.role === 'user' && (
                        <div className="sender-name">{msg.sender_name || '用户'}</div>
                      )}
                      {msg.content && !isStickerMessage && (!msg.file_url || (
                        msg.content.trim() !== `[文件] ${msg.file_name}` &&
                        msg.content.trim() !== `[文件]${msg.file_name}` &&
                        msg.content.trim() !== `[图片] ${msg.file_name}` &&
                        msg.content.trim() !== `[图片]${msg.file_name}`
                        )) && (
                          <div className="markdown-body">
                            <MarkdownRenderer content={msg.content} />
                          </div>
                        )}
                      {isStickerMessage && (
                        <div className="message-attachment">
                          <img
                            className="bubble-image"
                            src={sticker.src}
                            alt={sticker.name}
                            style={{ cursor: 'zoom-in' }}
                            onClick={() => setPreviewImage(sticker.src)}
                          />
                        </div>
                      )}
                      {msg.file_url && (
                        <div className="message-attachment">
                          {isImageAttachment(msg) ? (
                            <img
                              className="bubble-image"
                              src={withApiBase(msg.file_url)}
                              alt={msg.file_name || 'image'}
                              onClick={(e) => {
                                if (!e.target.classList.contains('expired')) {
                                  setPreviewImage(withApiBase(msg.file_url))
                                }
                              }}
                              onError={(e) => {
                                e.target.onerror = null;
                                e.target.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 300 100'%3E%3Crect width='300' height='100' fill='%23f5f5f5'/%3E%3Ctext x='150' y='50' font-family='sans-serif' font-size='14' fill='%23999' text-anchor='middle' alignment-baseline='middle'%3E图片已过期或被清理%3C/text%3E%3C/svg%3E";
                                e.target.classList.add('expired');
                                e.target.style.cursor = 'default';
                              }}
                              style={{ cursor: 'zoom-in' }}
                            />
                          ) : (
                            <div
                              className={`file-attachment-card ${isTextFile(msg.file_name) ? 'clickable' : ''}`}
                              onClick={() => isTextFile(msg.file_name) && handlePreviewFile(msg.file_name, msg.file_url)}
                            >
                              <div className={`file-icon ${getFileClass(msg.file_name)}`}>{getFileIcon(msg.file_name)}</div>
                              <div className="file-meta">
                                <span className="file-name">{msg.file_name || '文件'}</span>
                                <span className="file-size">{getFileSubtitle(msg.file_name, msg.mime_type)}</span>
                              </div>

                              <a className="file-download-btn" href={withApiBase(`/api/download?path=${encodeURIComponent(msg.file_url)}&name=${encodeURIComponent(msg.file_name)}&token=${encodeURIComponent(getToken())}`)} download={msg.file_name} target="_blank" rel="noreferrer" onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const res = await fetch(withApiBase(msg.file_url), { method: 'HEAD' });
                                  if (!res.ok && res.status === 404) {
                                    e.preventDefault();
                                    alert('文件已过期或被系统自动清理');
                                  }
                                } catch (err) { }
                              }}>
                                <Download size={18} />
                              </a>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              {isWaiting && (
                <div className="bubble-row assistant typing-indicator-row">
                  <div className="msg-avatar">
                    <img src={resolveBackendAssetUrl(activeConv?.ai_avatar) || resolveBackendAssetUrl(currentUser?.ai_avatar) || aiAvatar} alt="AI" />
                  </div>
                  <div className="bubble typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <form className="composer" onSubmit={handleSend}>
              <div className="composer-actions">
                <button
                  type="button"
                  className="icon-button attach-button"
                  onClick={() => fileInputRef.current?.click()}
                  title="上传文件"
                >
                  ＋
                </button>
                <button
                  type="button"
                  className={`icon-button sticker-button ${showStickerPicker ? 'active' : ''}`}
                  onClick={() => setShowStickerPicker(prev => !prev)}
                  title="发送表情包"
                >
                  <SmilePlus size={20} />
                </button>
                <input
                  type="file"
                  ref={fileInputRef}
                  hidden
                  onChange={handleFileChange}
                />
                {showStickerPicker && (
                  <div className="sticker-picker">
                    {stickers.map(sticker => (
                      <button
                        key={sticker.name}
                        type="button"
                        className="sticker-item"
                        onClick={() => sendSticker(sticker)}
                        title={sticker.name}
                      >
                        <img src={sticker.src} alt={sticker.name} />
                        <span>{sticker.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="compose-main">
                {pendingFile && (
                  <div className="attachment-preview">
                    已选择：{pendingFile.name}
                    <button type="button" className="clear-file" onClick={() => setPendingFile(null)}>×</button>
                  </div>
                )}
                <textarea
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend(e)
                    }
                  }}
                  placeholder="输入消息，Enter 发送"
                  rows="1"
                />
              </div>

              <button className="send-button-icon" type="submit" title="发送消息">
                <Send size={20} />
              </button>
            </form>
          </div>
        ) : (
          <div className="empty-chat-state">
            <div className="empty-chat-content">
              <h2>欢迎来到 WebChat</h2>
              <p>请在左侧选择一个现有对话，或创建一个新频道开始聊天吧！</p>
            </div>
          </div>
        )}
      </section>
      {showUserSettings && createPortal(
        <div className="user-settings-overlay" onClick={() => setShowUserSettings(false)}>
          <div className="user-settings-modal" onClick={(e) => e.stopPropagation()}>
            <div className="user-settings-header">
              <h3>账号设置</h3>
              <button className="close-btn" onClick={() => setShowUserSettings(false)}><X size={20} /></button>
            </div>
            <div className="user-settings-body">
              <div className="form-group">
                <label>昵称</label>
                <input
                  type="text"
                  value={userProfileData.display_name}
                  onChange={e => setUserProfileData(prev => ({ ...prev, display_name: e.target.value }))}
                  placeholder="输入新昵称"
                />
              </div>
              <div className="form-group">
                <label>用户头像</label>
                <div className="avatar-upload-row">
                  <div className="avatar-preview">
                    <img src={resolveBackendAssetUrl(userProfileData.avatar) || userAvatar} alt="用户头像" />
                  </div>
                  <button type="button" className="upload-avatar-btn" onClick={() => uploadUserAvatar('user')}>
                    <UploadCloud size={16} /> 上传头像
                  </button>
                </div>
              </div>
              <div className="form-group">
                <label>AI 名字</label>
                <input
                  type="text"
                  value={userProfileData.ai_name || ''}
                  onChange={e => setUserProfileData(prev => ({ ...prev, ai_name: e.target.value }))}
                  placeholder="输入AI的新名字"
                />
              </div>
              <div className="form-group">
                <label>AI 头像</label>
                <div className="avatar-upload-row">
                  <div className="avatar-preview">
                    <img src={resolveBackendAssetUrl(userProfileData.ai_avatar) || aiAvatar} alt="AI头像" />
                  </div>
                  <button type="button" className="upload-avatar-btn" onClick={() => uploadUserAvatar('ai')}>
                    <UploadCloud size={16} /> 上传头像
                  </button>
                </div>
              </div>
            </div>
            <div className="user-settings-footer">
              <button className="btn-cancel" onClick={() => setShowUserSettings(false)}>取消</button>
              <button className="btn-save" onClick={saveUserSettings}>保存修改</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {showAllMembersModal && createPortal(
        <div className="user-settings-overlay" onClick={() => setShowAllMembersModal(false)}>
          <div className="user-settings-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="user-settings-header">
              <h3>群聊成员 ({groupMembers.length})</h3>
              <button className="close-btn" onClick={() => setShowAllMembersModal(false)}><X size={20} /></button>
            </div>
            <div className="user-settings-body" style={{ maxHeight: '400px', overflowY: 'auto', padding: '12px 0' }}>
              {groupMembers.map(m => (
                <div key={m.user_id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <img src={resolveBackendAssetUrl(m.avatar) || userAvatar} alt={m.display_name} style={{ width: '36px', height: '36px', borderRadius: '50%', objectFit: 'cover' }} />
                    <div>
                      <span style={{ fontWeight: '500', color: 'var(--text-main)' }}>{m.display_name}</span>
                      {m.is_owner && <span style={{ marginLeft: '6px', fontSize: '0.7rem', padding: '2px 6px', borderRadius: '4px', background: '#eff6ff', color: '#3b82f6' }}>群主</span>}
                    </div>
                  </div>
                  {activeConv?.user_id === currentUser?.id && !m.is_owner && (
                    <button
                      onClick={() => {
                        if (window.confirm(`确定要将 ${m.display_name} 移出群聊吗？`)) {
                          removeMember(m.user_id)
                        }
                      }}
                      style={{ fontSize: '0.8rem', padding: '4px 10px', borderRadius: 'var(--radius-sm)', background: '#fee2e2', color: '#ef4444', border: '1px solid #fca5a5', cursor: 'pointer' }}
                    >
                      移除
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body
      )}
      {previewImage && createPortal(
        <div className="image-preview-overlay" onClick={() => setPreviewImage(null)}>
          <button className="close-preview" onClick={() => setPreviewImage(null)}><X size={24} /></button>
          <img src={previewImage} alt="Preview" onClick={(e) => e.stopPropagation()} />
        </div>,
        document.body
      )}
      {previewFile && createPortal(
        <div className="file-preview-overlay" onClick={() => setPreviewFile(null)}>
          <div className="file-preview-modal" onClick={(e) => e.stopPropagation()}>
            <div className="file-preview-header">
              <span className="file-preview-title">{previewFile.name}</span>
              <button className="close-preview-btn" onClick={() => setPreviewFile(null)}><X size={24} /></button>
            </div>
            <div className="file-preview-body">
              {previewFile.type === 'md' && (
                <div className="markdown-body">
                  <MarkdownRenderer content={previewFile.content} />
                </div>
              )}
              {previewFile.type === 'html' && (
                <iframe
                  srcDoc={previewFile.content}
                  title={previewFile.name}
                  style={{ width: '100%', height: '100%', minHeight: '500px', border: 'none', background: 'white' }}
                />
              )}
              {previewFile.type === 'text' && (
                <SyntaxHighlighter
                  language={previewFile.name.split('.').pop().toLowerCase()}
                  style={atomDark}
                  customStyle={{ margin: 0, borderRadius: 'var(--radius-md)', padding: '16px' }}
                >
                  {previewFile.content}
                </SyntaxHighlighter>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
      {showCropper && createPortal(
        <div className="user-settings-overlay" style={{ zIndex: 100000 }} onClick={() => setShowCropper(false)}>
          <div className="user-settings-modal" style={{ maxWidth: '400px' }} onClick={(e) => e.stopPropagation()}>
            <div className="user-settings-header">
              <h3>裁剪头像</h3>
              <button className="close-btn" onClick={() => setShowCropper(false)}><X size={20} /></button>
            </div>
            <div className="user-settings-body" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', padding: '20px 10px' }}>
              <div 
                style={{ 
                  width: '240px', 
                  height: '240px', 
                  borderRadius: '50%', 
                  overflow: 'hidden', 
                  position: 'relative', 
                  border: '2px solid var(--primary)',
                  background: '#1a1a1a',
                  cursor: 'move',
                  userSelect: 'none',
                  boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)'
                }}
                onMouseDown={handleDragStart}
                onMouseMove={handleDragMove}
                onMouseUp={handleDragEnd}
                onMouseLeave={handleDragEnd}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleDragEnd}
              >
                <img 
                  src={cropperImage} 
                  alt="裁剪预览" 
                  style={{
                    position: 'absolute',
                    top: '50%',
                    left: '50%',
                    transform: `translate(calc(-50% + ${cropperOffset.x}px), calc(-50% + ${cropperOffset.y}px)) scale(${cropperScale})`,
                    transformOrigin: 'center',
                    maxWidth: 'none',
                    maxHeight: 'none',
                    width: '240px',
                    height: 'auto'
                  }}
                  draggable="false"
                />
              </div>
              
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '0 10px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', minWidth: '30px' }}>缩放</span>
                <input 
                  type="range" 
                  min="0.5" 
                  max="4" 
                  step="0.01" 
                  value={cropperScale} 
                  onChange={(e) => setCropperScale(parseFloat(e.target.value))} 
                  style={{ flex: 1, accentColor: 'var(--primary)' }}
                />
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textAlign: 'center', margin: 0 }}>
                拖拽图片调整位置，自动压缩为 WebP (800x800)
              </p>
            </div>
            <div className="user-settings-footer">
              <button className="btn-cancel" onClick={() => setShowCropper(false)}>取消</button>
              <button className="btn-save" onClick={handleCropperSave}>保存裁剪</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </main>
  )
}
