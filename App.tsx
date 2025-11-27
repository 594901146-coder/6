import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, FileMetadata, ChatMessage } from './types';
import { generateConnectionPhrase } from './services/geminiService';
import { Button } from './components/Button';
import { ProgressBar } from './components/ProgressBar';
import { 
  Send, 
  Download, 
  Wifi, 
  Loader2, 
  Copy, 
  FileIcon, 
  ArrowRight,
  ShieldCheck,
  Zap,
  AlertTriangle,
  QrCode,
  ScanLine,
  X,
  Camera,
  Paperclip,
  ArrowUpCircle,
  Activity,
  HelpCircle,
  Terminal,
  Server,
  RefreshCw,
  Sparkles,
  Lock,
  User,
  CheckCheck
} from 'lucide-react';

// Main Component
const App: React.FC = () => {
  // --- STATE ---
  const [appState, setAppState] = useState<AppState>(AppState.HOME);
  
  // Connection Setup
  const [role, setRole] = useState<'sender' | 'receiver' | null>(null);
  const [peerId, setPeerId] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<string>('Disconnected');
  const [serverStatus, setServerStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  // UX State
  const [isGeneratingId, setIsGeneratingId] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  
  // Chat & Transfer State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  
  // Transfer Control
  const [isTransferring, setIsTransferring] = useState(false);

  // --- REFS ---
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const scannerRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const connectionTimeoutRef = useRef<any>(null);
  const heartbeatRef = useRef<any>(null);

  // Buffer Refs for Receiving
  const incomingFileIdRef = useRef<string | null>(null);
  const receivedChunksRef = useRef<BlobPart[]>([]);
  const receivedSizeRef = useRef<number>(0);
  const currentIncomingMetaRef = useRef<FileMetadata | null>(null);
  const fileMetaRef = useRef<FileMetadata | null>(null);
  const pendingFileTransferRef = useRef<File | null>(null);

  // --- LIFECYCLE & HELPERS ---

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(100)); // Limit logs, keep logic simple
    console.log(`[AppLog] ${msg}`);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopHeartbeat();
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // --- HEARTBEAT ---
  const startHeartbeat = () => {
    stopHeartbeat();
    heartbeatRef.current = setInterval(() => {
      if (connRef.current && connRef.current.open) {
        // Send a tiny packet to keep NAT mapping alive
        try {
            connRef.current.send({ type: 'PING' });
        } catch (e) {
            console.warn("Heartbeat failed", e);
        }
      }
    }, 4000); // 4 seconds
  };

  const stopHeartbeat = () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
  };

  // --- SCANNER LOGIC ---
  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      const timer = setTimeout(() => {
        const startScanner = async () => {
          if (typeof window.Html5Qrcode === 'undefined') {
            setErrorMsg("扫码组件加载失败，请刷新页面重试");
            setIsScanning(false);
            return;
          }
          try {
            const html5QrCode = new window.Html5Qrcode("reader");
            scannerRef.current = html5QrCode;
            
            // Configuration for better scanning
            const config = { 
              fps: 10, 
              // REMOVED qrbox constraint. 
              // Allowing the library to scan the full video frame is much more robust
              // and fixes issues where CSS scaling (object-fit: cover) mismatches the logic.
              disableFlip: false,
              videoConstraints: {
                  facingMode: "environment",
                  // Try to use auto focus if available
                  focusMode: "continuous"
              }
            };
            
            await html5QrCode.start(
              { facingMode: "environment" }, 
              config,
              (decodedText: string) => {
                if (decodedText && decodedText.length > 3) {
                  if (navigator.vibrate) navigator.vibrate(50);
                  stopScanner();
                  // Clean ID from URL if scanned from URL
                  const cleanId = decodedText.split('/').pop() || decodedText;
                  connectToTarget(cleanId);
                }
              },
              () => {} 
            );
          } catch (err) {
            console.warn("Scanner error:", err);
            setErrorMsg("无法访问摄像头，请检查权限设置");
            setIsScanning(false);
          }
        };
        startScanner();
      }, 300); 
      return () => clearTimeout(timer);
    }
  }, [isScanning]);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (e) {
        console.warn("Stop scanner error", e);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  // --- PEER INITIALIZATION ---
  const initializePeer = useCallback((id?: string) => {
    if (peerRef.current && !peerRef.current.destroyed) {
        addLog("检测到现有 Peer 连接，重用中...");
        if (peerRef.current.disconnected) {
            addLog("连接已断开，尝试重连信令服务器...");
            peerRef.current.reconnect();
        }
        return peerRef.current;
    }
    
    if (typeof window.Peer === 'undefined') {
      const msg = "PeerJS 组件加载失败，请检查网络";
      setErrorMsg(msg);
      addLog(msg);
      setAppState(AppState.ERROR);
      return null;
    }

    try {
      setServerStatus('connecting');
      addLog(`正在初始化 P2P 节点 (ID: ${id || '自动生成'})...`);
      
      // Auto-detect secure requirement (Localhost usually HTTP, Vercel is HTTPS)
      const isSecure = window.location.protocol === 'https:';

      const peer = new window.Peer(id, {
        debug: 1,
        secure: isSecure, 
        config: {
          // Optimized list for China & Global
          iceServers: [
            { urls: 'stun:stun.miwifi.com' },          // China Xiaomi
            { urls: 'stun:stun.qq.com:3478' },         // China Tencent
            { urls: 'stun:stun.l.google.com:19302' },  // Global Google
            { urls: 'stun:global.stun.twilio.com:3478'} // Backup
          ],
          iceCandidatePoolSize: 10,
        }
      });

      peer.on('open', (myId: string) => {
        addLog(`✅ 信令服务器连接成功。ID: ${myId}`);
        setPeerId(myId);
        setServerStatus('connected');
        setErrorMsg('');
      });

      peer.on('connection', (conn: any) => {
        addLog(`📩 收到来自 ${conn.peer} 的连接请求`);
        handleConnection(conn);
      });

      peer.on('disconnected', () => {
        addLog("⚠️ 与信令服务器断开连接 (可能网络不稳定)");
        setServerStatus('disconnected');
        // Auto-reconnect logic
        // setTimeout(() => { if(peer && !peer.destroyed) peer.reconnect(); }, 2000);
      });

      peer.on('close', () => {
        addLog("🚫 P2P 节点已关闭");
        setServerStatus('disconnected');
        setPeerId('');
      });

      peer.on('error', (err: any) => {
        addLog(`❌ P2P 错误: ${err.type} - ${err.message}`);
        setServerStatus('disconnected');
        setIsConnecting(false); 
        
        let msg = `连接错误: ${err.type}`;
        if (err.type === 'peer-unavailable') msg = "找不到该房间。请确认口令正确且对方在线。";
        else if (err.type === 'network') msg = "网络连接失败，无法连接到信令服务器。";
        else if (err.type === 'server-error') msg = "信令服务器暂时不可用。";
        else if (err.type === 'unavailable-id') msg = "ID 冲突，正在重试...";
        
        setErrorMsg(msg);
      });

      peerRef.current = peer;
      return peer;
    } catch (e: any) {
      addLog(`初始化异常: ${e.message}`);
      setErrorMsg("初始化失败: " + e.message);
      setAppState(AppState.ERROR);
      return null;
    }
  }, []);

  const handleConnection = (conn: any) => {
    // Clean up existing connection if any
    if (connRef.current) {
        addLog("关闭旧连接，接受新连接...");
        connRef.current.close();
    }
    
    connRef.current = conn;
    
    conn.on('open', () => {
      addLog(`✅ 数据通道已打开! 对方: ${conn.peer}`);
      // Don't set 'Connected' immediately, verify with PING
      conn.send({ type: 'PING' });
      startHeartbeat();
    });

    conn.on('data', (data: any) => {
      // PING/PONG Handling for connection verification
      if (data && data.type === 'PING') {
          conn.send({ type: 'PONG' });
          return;
      }
      if (data && data.type === 'PONG') {
          if (connectionStatus !== 'Connected') {
              addLog(`🤝 连接握手确认成功！`);
              setConnectionStatus('Connected');
              setIsConnecting(false);
              setErrorMsg('');
              setAppState(AppState.CHAT);
          }
          return;
      }

      handleIncomingData(data);
    });

    conn.on('close', () => {
      addLog("对方断开了连接");
      setConnectionStatus('Disconnected');
      setIsConnecting(false);
      stopHeartbeat();
      addSystemMessage("对方已断开连接");
    });
    
    conn.on('error', (err: any) => {
      addLog(`连接错误: ${err}`);
      setIsConnecting(false);
      setConnectionStatus('Disconnected');
      addSystemMessage("连接发生错误");
    });
  };

  // --- DATA HANDLING ---
  
  const handleIncomingData = (data: any) => {
    // Robust binary check
    const isBinary = 
        data instanceof ArrayBuffer || 
        data instanceof Uint8Array || 
        data instanceof Blob || 
        (data && data.constructor && data.constructor.name === 'ArrayBuffer') ||
        (data && data.buffer instanceof ArrayBuffer) ||
        (data && data.type === 'Buffer'); 
    
    if (isBinary) {
      handleFileChunk(data);
      return;
    }

    if (data && data.type) {
      switch (data.type) {
        case 'TEXT':
          const newMsg: ChatMessage = {
            id: Date.now().toString() + Math.random(),
            sender: 'peer',
            type: 'text',
            content: data.payload,
            timestamp: Date.now()
          };
          setMessages(prev => [...prev, newMsg]);
          break;

        case 'FILE_START':
          const meta = data.payload as FileMetadata;
          addLog(`📥 接收文件请求: ${meta.name} (${(meta.size/1024).toFixed(1)} KB)`);
          
          currentIncomingMetaRef.current = meta;
          fileMetaRef.current = meta; 
          incomingFileIdRef.current = meta.id;
          receivedChunksRef.current = [];
          receivedSizeRef.current = 0;
          
          setIsTransferring(true);

          setMessages(prev => [...prev, {
            id: meta.id, 
            sender: 'peer',
            type: 'file',
            fileMeta: meta,
            progress: 0,
            status: 'transferring',
            timestamp: Date.now()
          }]);
          
          // Ack to start stream
          setTimeout(() => {
             if(connRef.current && connRef.current.open) {
                 addLog("发送 ACK_FILE_START");
                 connRef.current.send({ type: 'ACK_FILE_START' });
             }
          }, 50);
          break;
        
        case 'ACK_FILE_START':
           if (pendingFileTransferRef.current) {
             addLog("📤 对方已确认，开始上传数据...");
             streamFile(pendingFileTransferRef.current);
             pendingFileTransferRef.current = null;
           }
           break;
      }
    }
  };

  const handleFileChunk = (data: any) => {
    const meta = currentIncomingMetaRef.current || fileMetaRef.current;
    if (!meta) return;
    
    let chunk: Blob;
    if (data instanceof Blob) {
        chunk = data;
    } else if (data instanceof ArrayBuffer) {
        chunk = new Blob([data]);
    } else {
        chunk = new Blob([data]);
    }

    receivedChunksRef.current.push(chunk);
    receivedSizeRef.current += chunk.size;

    const total = meta.size;
    const progress = Math.round((receivedSizeRef.current / total) * 100);

    if (progress % 5 === 0 || progress >= 100) {
        setMessages(prev => prev.map(m => {
            if (m.id === meta.id) return { ...m, progress: progress };
            return m;
        }));
    }

    if (receivedSizeRef.current >= total) {
        addLog("✅ 文件接收完毕，合成中...");
        const blob = new Blob(receivedChunksRef.current, { type: meta.type });
        const url = URL.createObjectURL(blob);
        
        setMessages(prev => prev.map(m => {
            if (m.id === meta.id) {
                return { ...m, progress: 100, status: 'completed', fileUrl: url };
            }
            return m;
        }));

        currentIncomingMetaRef.current = null;
        fileMetaRef.current = null;
        incomingFileIdRef.current = null;
        receivedChunksRef.current = [];
        receivedSizeRef.current = 0;
        setIsTransferring(false);
    }
  };

  const addSystemMessage = (text: string) => {
      setMessages(prev => [...prev, {
          id: Date.now().toString(),
          sender: 'peer',
          type: 'text',
          content: `[系统] ${text}`,
          timestamp: Date.now()
      }]);
  };

  // --- ACTIONS ---

  const startRoom = async () => {
    setIsGeneratingId(true);
    setRole('sender');
    setAppState(AppState.SETUP);
    setShowQr(false);
    setErrorMsg('');
    setLogs([]); 
    addLog("正在创建房间...");
    
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }

    try {
      const id = await generateConnectionPhrase();
      addLog(`生成 ID: ${id}`);
      initializePeer(id);
    } catch (e: any) {
      addLog(`ID生成失败: ${e.message}`);
      const fallbackId = `drop-${Math.floor(Math.random()*10000)}`;
      initializePeer(fallbackId);
    } finally {
      setIsGeneratingId(false);
    }
  };

  const joinRoom = () => {
    setRole('receiver');
    setAppState(AppState.SETUP);
    setErrorMsg('');
    setLogs([]);
    addLog("初始化接收端...");
    
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }
    
    // Auto-generate local ID for receiver
    const localId = `recv-${Math.floor(Math.random() * 100000)}`;
    initializePeer(localId); 
  };

  const reconnectPeer = () => {
      addLog("手动重置网络连接...");
      if (peerRef.current) peerRef.current.destroy();
      setTimeout(() => {
          if (role === 'sender') startRoom();
          else joinRoom();
      }, 500);
  }

  const connectToTarget = (overrideId?: string, isRetry = false) => {
    const rawId = typeof overrideId === 'string' ? overrideId : targetPeerId;
    const target = rawId?.trim().toLowerCase(); 
    
    if (!peerRef.current || !peerRef.current.id) {
        setErrorMsg("网络未就绪，请等待服务器连接变绿");
        addLog("错误: 本地 Peer 未就绪");
        return;
    }
    if (!target) {
        setErrorMsg("请输入房间口令");
        return;
    }
    if (target === peerId) {
        setErrorMsg("不能连接到自己");
        return;
    }
    
    if (overrideId) setTargetPeerId(target);

    if (!isRetry) {
        setIsConnecting(true);
        setErrorMsg('');
        setRetryCount(0);
    }
    
    addLog(`🚀 发起连接 -> 目标: ${target} ${isRetry ? '(重试)' : ''}`);
    
    // Close old
    if (connRef.current) connRef.current.close();
    if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);

    // Force strict reliable mode without serialization option (defaults to binary)
    try {
        const conn = peerRef.current.connect(target, { 
            reliable: true 
        });
        
        if (!conn) throw new Error("连接对象创建失败");
        
        handleConnection(conn);

        // Connection Timeout Logic
        connectionTimeoutRef.current = setTimeout(() => {
            if (isConnecting && connectionStatus !== 'Connected') {
                 addLog("连接超时 (10s)");
                 
                 // Retry Logic
                 if (retryCount < 2) {
                     setRetryCount(prev => prev + 1);
                     addLog(`自动重试连接 (${retryCount + 1}/3)...`);
                     connectToTarget(target, true);
                 } else {
                     setIsConnecting(false);
                     setErrorMsg("连接请求无响应。\n1. 请确保对方页面开着\n2. 对方没有在传输文件\n3. 尝试双方都刷新页面");
                     if (connRef.current) connRef.current.close();
                 }
            }
        }, 8000); // 8s timeout per attempt

    } catch (e: any) {
        console.error("Connect exception:", e);
        setErrorMsg("连接异常: " + e.message);
        addLog("连接异常: " + e.message);
        setIsConnecting(false);
    }
  };

  const sendMessage = () => {
    if (!inputText.trim() || !connRef.current) return;
    
    connRef.current.send({ type: 'TEXT', payload: inputText });
    
    setMessages(prev => [...prev, {
        id: Date.now().toString(),
        sender: 'me',
        type: 'text',
        content: inputText,
        timestamp: Date.now()
    }]);
    
    setInputText('');
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && connRef.current) {
        const file = e.target.files[0];
        if (isTransferring) {
            alert("请等待当前文件传输完成");
            return;
        }

        const transferId = Date.now().toString();
        const meta: FileMetadata = {
            id: transferId,
            name: file.name,
            size: file.size,
            type: file.type
        };

        setMessages(prev => [...prev, {
            id: transferId,
            sender: 'me',
            type: 'file',
            fileMeta: meta,
            progress: 0,
            status: 'transferring',
            timestamp: Date.now()
        }]);

        addLog(`请求发送文件: ${file.name}`);
        connRef.current.send({ type: 'FILE_START', payload: meta });
        pendingFileTransferRef.current = file;
        setIsTransferring(true);
        e.target.value = '';
    }
  };

  const streamFile = (file: File) => {
      // Small chunks for reliability
      const chunkSize = 16 * 1024; 
      let offset = 0;
      
      const readSlice = (o: number) => {
          if (!connRef.current || !connRef.current.open) {
              addLog("传输中断：连接已关闭");
              setIsTransferring(false);
              return;
          }

          const slice = file.slice(o, o + chunkSize);
          const reader = new FileReader();
          
          reader.onload = (evt) => {
              if (evt.target?.readyState === FileReader.DONE) {
                  try {
                    connRef.current.send(evt.target.result); 
                    offset += chunkSize;
                    
                    const progress = Math.min((offset / file.size) * 100, 100);
                    
                    if (progress % 5 === 0 || progress >= 100) {
                        setMessages(prev => prev.map(m => {
                            if (m.fileMeta?.name === file.name && m.sender === 'me' && m.status !== 'completed') {
                                return { ...m, progress: progress };
                            }
                            return m;
                        }));
                    }

                    if (offset < file.size) {
                        // 5ms throttle to prevent buffer overflow
                        setTimeout(() => readSlice(offset), 5);
                    } else {
                        addLog("文件发送完成");
                        setIsTransferring(false);
                        setMessages(prev => prev.map(m => {
                          if (m.fileMeta?.name === file.name && m.sender === 'me') {
                               return { ...m, progress: 100, status: 'completed' };
                          }
                          return m;
                        }));
                    }
                  } catch (err) {
                      console.error("Send error", err);
                      addLog("发送中断: " + err);
                      setIsTransferring(false);
                      addSystemMessage("文件发送中断");
                  }
              }
          };
          reader.readAsArrayBuffer(slice);
      };
      readSlice(0);
  };

  const exitChat = () => {
     if(connRef.current) connRef.current.close();
     if(peerRef.current) peerRef.current.destroy();
     window.location.reload();
  };

  // --- RENDERERS ---

  const renderHome = () => (
    <div className="flex flex-col md:flex-row gap-6 md:gap-8 max-w-4xl w-full animate-in fade-in slide-in-from-bottom-8 duration-700">
      <div 
        onClick={() => { startRoom(); }}
        className="flex-1 group cursor-pointer relative"
      >
        <div className="absolute inset-0 bg-indigo-500/20 blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-full"></div>
        <div className="glass-panel h-64 md:h-72 rounded-3xl p-6 md:p-8 flex flex-col items-center justify-center border border-white/5 bg-gradient-to-br from-slate-900/80 to-slate-950/80 hover:border-indigo-500/50 shadow-2xl transition-all duration-300 hover:-translate-y-2 group-hover:shadow-[0_0_40px_rgba(99,102,241,0.2)]">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-slate-800/50 flex items-center justify-center mb-5 md:mb-6 group-hover:bg-indigo-600/20 group-hover:scale-110 transition-all duration-300 border border-white/10 group-hover:border-indigo-500/50">
            {isGeneratingId ? <Loader2 className="w-8 h-8 md:w-10 md:h-10 text-indigo-400 animate-spin" /> : <Wifi className="w-8 h-8 md:w-10 md:h-10 text-slate-300 group-hover:text-indigo-400 transition-colors" />}
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-2 md:mb-3 text-white group-hover:text-indigo-300 transition-colors">我要发送</h2>
          <p className="text-slate-400 text-sm md:text-base text-center font-medium group-hover:text-slate-300">创建加密房间 • 生成口令</p>
          <div className="mt-4 md:mt-6 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
             <span className="text-indigo-400 flex items-center gap-1 text-sm font-bold">开始 <ArrowRight size={14}/></span>
          </div>
        </div>
      </div>

      <div 
        onClick={() => { joinRoom(); }}
        className="flex-1 group cursor-pointer relative"
      >
        <div className="absolute inset-0 bg-emerald-500/20 blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-full"></div>
        <div className="glass-panel h-64 md:h-72 rounded-3xl p-6 md:p-8 flex flex-col items-center justify-center border border-white/5 bg-gradient-to-br from-slate-900/80 to-slate-950/80 hover:border-emerald-500/50 shadow-2xl transition-all duration-300 hover:-translate-y-2 group-hover:shadow-[0_0_40px_rgba(16,185,129,0.2)]">
          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-slate-800/50 flex items-center justify-center mb-5 md:mb-6 group-hover:bg-emerald-600/20 group-hover:scale-110 transition-all duration-300 border border-white/10 group-hover:border-emerald-500/50">
            <Download className="w-8 h-8 md:w-10 md:h-10 text-slate-300 group-hover:text-emerald-400 transition-colors" />
          </div>
          <h2 className="text-2xl md:text-3xl font-bold mb-2 md:mb-3 text-white group-hover:text-emerald-300 transition-colors">我要接收</h2>
          <p className="text-slate-400 text-sm md:text-base text-center font-medium group-hover:text-slate-300">输入口令 • 扫码连接</p>
          <div className="mt-4 md:mt-6 opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
             <span className="text-emerald-400 flex items-center gap-1 text-sm font-bold">加入 <ArrowRight size={14}/></span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSetup = () => (
    <div className="glass-panel p-6 md:p-8 rounded-3xl max-w-lg w-full animate-in slide-in-from-bottom-8 duration-500 relative border border-white/10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] bg-slate-900/60 backdrop-blur-2xl">
      {/* Consolidated Header with Toolbar */}
      <div className="flex justify-between items-start mb-6 md:mb-8">
        <div className="flex items-center gap-3 md:gap-4">
             <div className={`p-2.5 md:p-3 rounded-2xl ${role === 'sender' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                {role === 'sender' ? <Wifi size={20} className="md:w-6 md:h-6" /> : <Download size={20} className="md:w-6 md:h-6" />}
             </div>
             <div>
                 <h2 className="text-xl md:text-2xl font-bold text-white leading-none mb-1">{role === 'sender' ? '等待连接' : '加入传输'}</h2>
                 <p className="text-xs md:text-sm text-slate-400">{role === 'sender' ? '分享下方口令' : '连接到发送方'}</p>
             </div>
        </div>

        {/* Toolbar Group */}
        <div className="flex items-center gap-1 bg-slate-800/60 p-1 rounded-xl border border-white/5 backdrop-blur-sm">
           <button onClick={() => setShowLogs(!showLogs)} className={`p-1.5 md:p-2 rounded-lg transition-colors ${showLogs ? 'text-indigo-400 bg-indigo-500/20' : 'text-slate-400 hover:text-white hover:bg-white/10'}`} title="查看系统日志">
               <Terminal size={16} className="md:w-[18px] md:h-[18px]" />
           </button>
           <div className="w-px h-4 bg-white/10 mx-0.5"></div>
           <button onClick={() => setShowHelp(true)} className="p-1.5 md:p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors" title="核心技术原理">
               <Sparkles size={16} className="md:w-[18px] md:h-[18px]" />
           </button>
           <div className="w-px h-4 bg-white/10 mx-0.5"></div>
           <button onClick={exitChat} className="p-1.5 md:p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors" title="返回首页">
               <X size={16} className="md:w-[18px] md:h-[18px]" />
           </button>
        </div>
      </div>

      {role === 'sender' ? (
        <div className="space-y-6">
           <div className="bg-slate-950/50 p-6 rounded-2xl border border-dashed border-slate-700 text-center relative group">
            <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
            <p className="text-xs text-indigo-400 mb-3 uppercase tracking-widest font-bold">ROOM CODE</p>
            <div className="flex items-center justify-center gap-2 mb-4">
                {isGeneratingId ? (
                    <Loader2 className="animate-spin text-white w-8 h-8" />
                ) : (
                    <span className="text-3xl md:text-4xl font-mono font-bold text-white tracking-tight drop-shadow-[0_0_15px_rgba(255,255,255,0.3)] select-all break-all">
                        {peerId || '...'}
                    </span>
                )}
            </div>
            {peerId && (
                <div className="flex justify-center gap-3">
                    <button 
                        onClick={() => {
                            navigator.clipboard.writeText(peerId);
                            const btn = document.getElementById('copy-btn');
                            if(btn) { btn.innerHTML = '已复制'; setTimeout(() => btn.innerHTML = '复制口令', 1000); }
                        }} 
                        className="flex items-center gap-2 px-4 py-2.5 md:px-5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-medium transition-all shadow-lg shadow-indigo-500/25 hover:shadow-indigo-500/40"
                    >
                        <Copy size={16} /> <span id="copy-btn">复制口令</span>
                    </button>
                    <button 
                        onClick={() => setShowQr(!showQr)} 
                        className={`flex items-center gap-2 px-4 py-2.5 md:px-5 rounded-xl text-sm font-medium transition-all border ${showQr ? 'bg-white text-slate-900 border-white' : 'bg-transparent text-slate-300 border-slate-600 hover:border-slate-400 hover:text-white'}`}
                    >
                        <QrCode size={16} /> 二维码
                    </button>
                </div>
            )}
            
            <div className={`overflow-hidden transition-[max-height] duration-500 ease-in-out ${showQr ? 'max-h-64 mt-6' : 'max-h-0'}`}>
                <div className="flex flex-col items-center">
                    <div className="bg-white p-3 rounded-2xl shadow-xl">
                        <img src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(peerId)}&bgcolor=ffffff`} alt="QR" className="w-36 h-36 md:w-40 md:h-40 mix-blend-multiply" />
                    </div>
                </div>
            </div>
           </div>
           
           <div className="flex items-center justify-center gap-3 py-2 text-slate-400 bg-slate-800/30 rounded-full px-4 w-fit mx-auto border border-slate-700/50">
               <div className="relative">
                 <div className="w-3 h-3 bg-indigo-500 rounded-full animate-ping absolute opacity-75"></div>
                 <div className="w-3 h-3 bg-indigo-500 rounded-full relative"></div>
               </div>
               <span className="text-sm font-medium">正在等待接收方加入...</span>
           </div>
        </div>
      ) : (
        <div className="space-y-6">
           {/* Connection readiness check */}
           {!peerId ? (
             <div className="flex flex-col items-center justify-center py-12 space-y-4 text-slate-400 bg-slate-900/50 rounded-2xl border border-dashed border-slate-700/50">
               <Loader2 className="w-10 h-10 animate-spin text-emerald-500" />
               <p className="animate-pulse font-medium">正在初始化安全连接...</p>
             </div>
           ) : (
             <>
                <div className="relative">
                  <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-500">
                    <Lock size={18} />
                  </div>
                  <input 
                    type="text" 
                    value={targetPeerId}
                    onChange={(e) => {
                        setTargetPeerId(e.target.value);
                        if(errorMsg) setErrorMsg(''); 
                    }}
                    placeholder="输入房间口令"
                    className={`w-full bg-slate-950/50 border ${errorMsg ? 'border-red-500/50 focus:border-red-500' : 'border-slate-700 focus:border-emerald-500'} text-white pl-12 pr-14 py-4 rounded-xl focus:ring-1 focus:ring-emerald-500/50 outline-none font-mono text-base md:text-lg transition-all shadow-inner`}
                  />
                  <button 
                    onClick={() => setIsScanning(true)} 
                    className="absolute inset-y-2 right-2 px-3 bg-slate-800 hover:bg-slate-700 rounded-lg text-slate-300 hover:text-white transition-colors flex items-center justify-center" 
                    title="扫码"
                  >
                    <ScanLine size={20} />
                  </button>
                </div>
                
                {errorMsg && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                        <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        <div className="text-red-200 text-sm">
                            <p className="font-bold text-red-100 mb-1">连接受阻</p>
                            {errorMsg}
                            <div className="mt-3 flex gap-4">
                                <button onClick={() => setShowLogs(true)} className="text-white underline decoration-red-400/50 underline-offset-2 text-xs hover:decoration-red-400">查看日志</button>
                                <button onClick={reconnectPeer} className="text-white underline decoration-red-400/50 underline-offset-2 text-xs hover:decoration-red-400">重置网络</button>
                            </div>
                        </div>
                    </div>
                )}

                <Button 
                  onClick={() => connectToTarget()} 
                  variant="primary" 
                  isLoading={isConnecting}
                  className="w-full !bg-emerald-600 hover:!bg-emerald-500 shadow-lg shadow-emerald-500/25 !py-3.5 md:!py-4 !text-base md:!text-lg !rounded-xl"
                  icon={<ArrowRight size={20} />}
                >
                  {isConnecting ? `正在建立连接 ${retryCount > 0 ? `(${retryCount}/3)` : ''}...` : '立即连接'}
                </Button>
             </>
           )}
        </div>
      )}

      {/* DEBUG LOGS OVERLAY */}
      {showLogs && (
        <div className="mt-6 bg-black/80 backdrop-blur-md p-4 rounded-xl border border-slate-800 text-[10px] font-mono text-green-400/90 h-40 overflow-y-auto shadow-inner custom-scrollbar">
            <div className="flex justify-between sticky top-0 bg-black/0 pb-2 mb-2 border-b border-white/10">
                <span className="font-bold text-slate-300 flex items-center gap-2"><Activity size={12}/> 系统日志</span>
                <span className="cursor-pointer text-slate-500 hover:text-white transition-colors" onClick={() => setLogs([])}>清空</span>
            </div>
            {logs.length === 0 ? <span className="opacity-30 italic">等待系统事件...</span> : logs.map((l, i) => <div key={i} className="mb-1 border-b border-white/5 pb-1 last:border-0">{l}</div>)}
        </div>
      )}

      {/* QR SCANNER FULLSCREEN OVERLAY */}
      {isScanning && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center animate-in fade-in duration-300">
             {/* Force video to cover screen for immersive experience */}
            <style>{`
              #reader video { object-fit: cover !important; width: 100% !important; height: 100% !important; }
              @keyframes scanner-line {
                0% { transform: translateY(0); opacity: 0; }
                10% { opacity: 1; }
                90% { opacity: 1; }
                100% { transform: translateY(16rem); opacity: 0; }
              }
            `}</style>
            
            {/* Camera Feed Container */}
            <div id="reader" className="w-full h-full absolute inset-0"></div>

            {/* Dark Overlay Mask with Cutout */}
            <div className="absolute inset-0 pointer-events-none z-10">
               {/* This div creates the dark overlay around the clear center box using massive box-shadow */}
               <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 md:w-72 md:h-72 border-2 border-white/20 rounded-3xl shadow-[0_0_0_9999px_rgba(0,0,0,0.85)]">
                  {/* Corner Accents - Cyan/Indigo Gradient */}
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-2xl -mt-0.5 -ml-0.5"></div>
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-2xl -mt-0.5 -mr-0.5"></div>
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-2xl -mb-0.5 -ml-0.5"></div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-2xl -mb-0.5 -mr-0.5"></div>
                  
                  {/* Scanning Laser Line */}
                  <div className="absolute top-0 left-0 w-full h-12 bg-gradient-to-b from-emerald-500/0 via-emerald-500/20 to-emerald-500/0 animate-[scanner-line_2s_linear_infinite] border-b-2 border-emerald-400/50 drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
               </div>
            </div>

            {/* Top Bar */}
            <div className="absolute top-0 left-0 w-full p-6 z-20 pt-safe flex justify-between items-start">
                <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-4 py-2 flex items-center gap-2 text-white font-medium">
                   <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>
                   <span className="text-sm tracking-wide">REC</span>
                </div>
                <button 
                  onClick={stopScanner} 
                  className="bg-black/40 backdrop-blur-md border border-white/10 w-10 h-10 rounded-full flex items-center justify-center text-white hover:bg-white/10 transition-colors"
                >
                  <X size={20} />
                </button>
            </div>
            
            {/* Bottom Instructions REMOVED */}
        </div>
      )}
    </div>
  );

  const renderChat = () => (
    <div className="w-full h-[100dvh] md:h-[85vh] md:max-w-3xl flex flex-col glass-panel md:rounded-3xl rounded-none overflow-hidden shadow-2xl md:shadow-black/50 animate-in fade-in zoom-in-95 duration-500 md:border border-white/10 bg-[#020617] md:bg-transparent">
      {/* CHAT HEADER */}
      <div className="p-4 md:p-5 bg-slate-900/80 border-b border-white/5 flex justify-between items-center backdrop-blur-xl relative z-20 pt-safe-top">
         <div className="flex items-center gap-3 md:gap-4">
             <div className={`w-10 h-10 md:w-12 md:h-12 rounded-2xl flex items-center justify-center text-white font-bold shadow-lg ${role === 'sender' ? 'bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/20' : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/20'}`}>
                 {role === 'sender' ? <Wifi size={20} className="md:w-6 md:h-6" /> : <Download size={20} className="md:w-6 md:h-6" />}
             </div>
             <div>
                 <h3 className="font-bold text-white text-base md:text-lg tracking-tight">加密传输通道</h3>
                 <div className="flex items-center gap-2 mt-0.5">
                     <span className={`relative flex h-2 w-2 md:h-2.5 md:w-2.5`}>
                       <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                       <span className="relative inline-flex rounded-full h-2 w-2 md:h-2.5 md:w-2.5 bg-emerald-500"></span>
                     </span>
                     <span className="text-[10px] md:text-xs text-emerald-400 font-medium tracking-wide uppercase">Secure Connection</span>
                 </div>
             </div>
         </div>
         <button onClick={exitChat} className="p-2 md:p-3 hover:bg-white/5 rounded-full text-slate-400 hover:text-red-400 transition-all border border-transparent hover:border-white/5" title="断开连接">
             <X size={20} />
         </button>
      </div>

      {/* CHAT MESSAGES AREA */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth bg-transparent relative">
          {/* Subtle pattern in chat background */}
          <div className="absolute inset-0 opacity-5 pointer-events-none" style={{backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)', backgroundSize: '30px 30px'}}></div>

          {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full opacity-50 animate-in fade-in duration-1000">
                  <div className="w-20 h-20 md:w-24 md:h-24 bg-slate-800/50 rounded-full flex items-center justify-center mb-6 border border-white/5">
                    <ShieldCheck className="w-10 h-10 md:w-12 md:h-12 text-slate-500" />
                  </div>
                  <p className="text-slate-300 font-medium text-lg">通道已建立</p>
                  <p className="text-slate-500 text-sm mt-2 max-w-xs text-center">所有数据通过 WebRTC P2P 协议端到端加密传输，不经过第三方服务器。</p>
              </div>
          )}
          
          <div className="space-y-1">
          {messages.map((msg, index) => {
              const isMe = msg.sender === 'me';
              const isSequence = index > 0 && messages[index - 1].sender === msg.sender;
              
              return (
                  <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} ${isSequence ? 'mt-1' : 'mt-6'} animate-in slide-in-from-bottom-2 duration-300 group`}>
                      
                      {!isMe && (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mr-2 md:mr-3 border border-white/10 shadow-sm transition-opacity ${isSequence ? 'opacity-0' : 'bg-slate-800 text-slate-400'}`}>
                           {!isSequence && <User size={14} />}
                        </div>
                      )}

                      <div className={`max-w-[85%] sm:max-w-[70%] shadow-md relative transition-all hover:shadow-lg ${
                          isMe 
                          ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white border border-indigo-400/20' 
                          : 'bg-slate-800 text-slate-100 border border-slate-700/50'
                      } ${
                          isMe 
                            ? (isSequence ? 'rounded-2xl rounded-tr-md' : 'rounded-2xl rounded-tr-sm') 
                            : (isSequence ? 'rounded-2xl rounded-tl-md' : 'rounded-2xl rounded-tl-sm')
                      }`}>
                          <div className={`${msg.type === 'file' ? 'p-2' : 'px-3 py-2.5 md:px-4 md:py-3'}`}>
                              {/* Text Content */}
                              {msg.type === 'text' && <p className="break-words leading-relaxed whitespace-pre-wrap text-[15px]">{msg.content}</p>}

                              {/* File Content */}
                              {msg.type === 'file' && (
                                  <div className={`w-full sm:w-72 rounded-xl p-3 ${isMe ? 'bg-indigo-800/30' : 'bg-slate-900/50'} border ${isMe ? 'border-indigo-400/20' : 'border-white/5'}`}>
                                      <div className="flex items-center gap-3 mb-3">
                                          <div className={`p-2.5 rounded-lg shrink-0 ${isMe ? 'bg-indigo-500/20 text-white' : 'bg-slate-700 text-emerald-400'}`}>
                                              <FileIcon size={20} />
                                          </div>
                                          <div className="overflow-hidden min-w-0 flex-1">
                                              <p className="font-bold truncate text-sm mb-0.5" title={msg.fileMeta?.name}>{msg.fileMeta?.name}</p>
                                              <p className="text-[10px] opacity-70 font-mono">
                                                  {((msg.fileMeta?.size || 0) / (1024 * 1024)).toFixed(2)} MB
                                              </p>
                                          </div>
                                      </div>
                                      
                                      {/* Progress or Actions */}
                                      {msg.status === 'completed' ? (
                                          isMe ? (
                                            <div className="text-xs flex items-center justify-center gap-1.5 opacity-90 font-medium bg-black/20 py-2 rounded-lg w-full border border-white/5">
                                                <CheckCircle size={14} /> 传输成功
                                            </div>
                                          ) : (
                                            <a href={msg.fileUrl} download={msg.fileMeta?.name} className="block w-full">
                                                <button className="w-full bg-emerald-500 hover:bg-emerald-400 text-white py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 hover:scale-[1.02] border-t border-white/10">
                                                    <Download size={14} /> 下载
                                                </button>
                                            </a>
                                          )
                                      ) : (
                                          <div className="space-y-1.5">
                                              <div className="flex justify-between text-[10px] font-bold tracking-wide uppercase opacity-70">
                                                  <span>{msg.sender === 'me' ? 'Uploading...' : 'Downloading...'}</span>
                                                  <span>{msg.progress}%</span>
                                              </div>
                                              <ProgressBar progress={msg.progress || 0} heightClass="h-1.5" colorClass={isMe ? "bg-white" : "bg-emerald-400"} />
                                          </div>
                                      )}
                                  </div>
                              )}
                          </div>

                          {/* Timestamp & Status */}
                          <div className={`text-[10px] flex items-center gap-1 absolute -bottom-5 ${isMe ? 'right-0' : 'left-0'} font-medium text-slate-500 transition-opacity ${isSequence ? 'opacity-0 group-hover:opacity-100' : 'opacity-60'}`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              {isMe && <CheckCheck size={14} className={msg.status === 'completed' || msg.type === 'text' ? "text-indigo-400" : "text-slate-600"} />}
                          </div>
                      </div>
                  </div>
              )
          })}
          </div>
          <div ref={messagesEndRef} />
      </div>

      {/* INPUT AREA */}
      <div className="p-3 md:p-5 pb-4 md:pb-5 bg-slate-900/90 border-t border-white/5 backdrop-blur-xl z-20 safe-area-bottom">
          <div className="flex items-end gap-2 md:gap-3 relative">
              <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  onChange={onFileSelect}
                  disabled={isTransferring}
              />
              <button 
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isTransferring} 
                  className={`p-3 md:p-3.5 rounded-2xl transition-all shrink-0 shadow-lg ${isTransferring ? 'opacity-30 cursor-not-allowed bg-slate-800' : 'hover:bg-slate-700 text-slate-400 hover:text-indigo-400 bg-slate-800 border border-slate-700 hover:border-indigo-500/50'}`}
                  title="发送文件"
              >
                  <Paperclip size={20} className="md:w-[22px] md:h-[22px]" />
              </button>
              
              <div className="flex-1 relative group">
                  <textarea
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleKeyPress}
                      placeholder={isTransferring ? "传输期间文本输入已锁定..." : "发送消息..."}
                      disabled={isTransferring}
                      className="w-full bg-slate-800 border border-slate-700 text-white placeholder-slate-500 rounded-2xl py-3 pl-4 pr-10 md:py-3.5 md:pl-5 md:pr-12 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none resize-none min-h-[48px] md:min-h-[52px] text-base shadow-inner transition-all"
                      rows={1}
                      style={{ height: 'auto', minHeight: '48px' }}
                  />
                  {inputText && (
                    <div className="hidden md:block absolute right-3 bottom-3 text-xs text-slate-500 font-mono">Enter</div>
                  )}
              </div>
              
              <button 
                  onClick={sendMessage}
                  disabled={!inputText.trim() || isTransferring}
                  className={`p-3 md:p-3.5 rounded-2xl transition-all shrink-0 shadow-lg flex items-center justify-center ${
                      !inputText.trim() || isTransferring 
                      ? 'bg-slate-800 text-slate-600 cursor-not-allowed border border-slate-700' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/30 hover:scale-105 active:scale-95 border-t border-white/10'
                  }`}
              >
                  {isTransferring ? <Loader2 size={20} className="animate-spin md:w-[22px] md:h-[22px]" /> : <ArrowUpCircle size={22} className="md:w-[24px] md:h-[24px]" />}
              </button>
          </div>
          {isTransferring && (
            <div className="text-center mt-3 animate-pulse">
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-500 text-xs font-bold border border-amber-500/20">
                    <Activity size={12}/> 请保持页面开启，传输中...
                </span>
            </div>
          )}
      </div>
    </div>
  );

  const CheckCircle = ({size = 16}) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
  );

  return (
    <div className="min-h-screen flex flex-col items-center relative overflow-hidden font-sans selection:bg-indigo-500/30">
       
       {/* Background Grid Layer */}
       <div className="fixed inset-0 tech-grid z-0 opacity-40"></div>
       
       {/* Connection Status Indicator (Global) */}
       <div className="absolute top-4 right-4 md:top-6 md:right-6 z-50 flex gap-3 items-center">
            {serverStatus === 'connecting' && <div className="bg-slate-900/80 border border-yellow-500/30 text-yellow-400 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md shadow-lg animate-pulse"><Loader2 size={12} className="animate-spin"/> 连接服务器...</div>}
            {serverStatus === 'disconnected' && appState !== AppState.HOME && (
                <button onClick={reconnectPeer} className="bg-red-500/10 border border-red-500/50 text-red-400 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md shadow-lg hover:bg-red-500/20 transition-all cursor-pointer group">
                    <RefreshCw size={12} className="group-hover:rotate-180 transition-transform"/> 服务器离线
                </button>
            )}
            {serverStatus === 'connected' && appState !== AppState.HOME && (
                 <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md shadow-lg">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    在线
                 </div>
            )}
       </div>

       {/* HELP MODAL */}
       {showHelp && (
           <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={() => setShowHelp(false)}>
               <div className="bg-slate-900 border border-slate-700/80 p-6 md:p-8 rounded-3xl max-w-md w-full shadow-2xl relative overflow-hidden" onClick={e => e.stopPropagation()}>
                   <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500"></div>
                   <div className="flex justify-between items-center mb-6">
                       <h3 className="text-xl font-bold flex items-center gap-2 text-white"><Sparkles className="text-yellow-400" size={20}/> 核心技术原理</h3>
                       <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-white transition-colors bg-white/5 p-2 rounded-full"><X size={20}/></button>
                   </div>
                   <div className="space-y-5 text-slate-300 text-sm leading-relaxed">
                       <p>NexusDrop 使用前沿的 <span className="text-indigo-400 font-bold">WebRTC</span> 技术实现浏览器间的直接通信。</p>
                       
                       <div className="bg-slate-950 p-4 rounded-xl border border-white/5">
                           <div className="flex items-center gap-3 mb-2">
                               <Server size={18} className="text-indigo-400"/>
                               <strong className="text-white">1. 信令握手</strong>
                           </div>
                           <p className="text-xs text-slate-400 pl-8">设备A和设备B通过服务器交换“网络名片”（SDP信息）。这就像两个人互换电话号码。</p>
                       </div>

                       <div className="bg-slate-950 p-4 rounded-xl border border-white/5">
                           <div className="flex items-center gap-3 mb-2">
                               <ShieldCheck size={18} className="text-emerald-400"/>
                               <strong className="text-white">2. P2P 直连</strong>
                           </div>
                           <p className="text-xs text-slate-400 pl-8">一旦“电话”打通，服务器立即断开。您的文件直接从设备A飞到设备B，<span className="text-emerald-400">不经过任何云端存储</span>。</p>
                       </div>
                   </div>
                   <button onClick={() => setShowHelp(false)} className="w-full mt-8 py-3 bg-white text-slate-900 hover:bg-slate-200 rounded-xl font-bold transition-colors">明白，开始传输</button>
               </div>
           </div>
       )}

       {/* Ambient Light Orbs */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[800px] h-[800px] bg-indigo-600/10 rounded-full blur-[120px] animate-float opacity-40"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-emerald-600/5 rounded-full blur-[120px] animate-float opacity-30" style={{animationDelay: '-3s'}}></div>
      </div>

      {/* Hide Global Header on Mobile when in Chat to maximize space */}
      <header className={`w-full text-center z-10 transition-all duration-700 ease-out ${appState === AppState.CHAT ? 'hidden md:flex py-6' : 'flex py-12 md:py-24'} ${appState === AppState.SETUP ? 'py-6' : ''}`}>
        {appState === AppState.HOME ? (
            <div className="animate-in fade-in slide-in-from-top-8 duration-1000 px-4">
                <div className="inline-flex items-center gap-2 mb-6 bg-slate-800/80 px-4 py-1.5 rounded-full border border-slate-700 backdrop-blur-md shadow-lg hover:border-indigo-500/30 transition-colors">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500"></span>
                    </span>
                    <span className="text-slate-300 font-semibold tracking-wide text-xs uppercase">V 3.0 • Serverless Transfer</span>
                </div>
                <h1 className="text-5xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white via-white to-slate-500 mb-6 tracking-tighter drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]">
                    Nexus<span className="text-indigo-500 inline-block hover:scale-105 transition-transform cursor-default">Drop</span>
                </h1>
                <p className="text-lg md:text-xl text-slate-400 max-w-2xl mx-auto px-6 font-medium leading-relaxed">
                    下一代文件传输协议。<br className="md:hidden"/>
                    <span className="text-slate-300">安全、极速、无限制</span>。
                </p>
            </div>
        ) : (
            <div onClick={() => { if(confirm('确定返回首页？当前连接将断开')) window.location.reload() }} className="cursor-pointer group inline-flex flex-col items-center">
                <h1 className="text-2xl font-black text-white tracking-tight group-hover:text-indigo-300 transition-colors drop-shadow-lg">
                    Nexus<span className="text-indigo-500">Drop</span>
                </h1>
            </div>
        )}
      </header>

      {/* Main Content Area - Full screen on mobile chat */}
      <main className={`flex-1 flex flex-col items-center w-full z-10 ${appState === AppState.CHAT ? 'justify-end md:justify-center p-0 md:px-4 md:pb-12' : 'justify-center px-4 pb-12'}`}>
        {appState === AppState.HOME && renderHome()}
        {appState === AppState.SETUP && renderSetup()}
        {appState === AppState.CHAT && renderChat()}
        {appState === AppState.ERROR && (
            <div className="glass-panel p-10 rounded-3xl max-w-md w-full text-center border border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.2)] bg-slate-900/80">
                <div className="w-24 h-24 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/20">
                    <AlertTriangle className="w-12 h-12 text-red-500" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">连接中断</h3>
                <p className="text-slate-400 mb-8 leading-relaxed text-sm">{errorMsg}</p>
                <Button variant="secondary" onClick={() => window.location.reload()} className="w-full">重新加载</Button>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;