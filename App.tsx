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
  RefreshCw
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

  // Buffer Refs for Receiving
  const incomingFileIdRef = useRef<string | null>(null);
  const receivedChunksRef = useRef<BlobPart[]>([]);
  const receivedSizeRef = useRef<number>(0);
  const currentIncomingMetaRef = useRef<FileMetadata | null>(null);
  const fileMetaRef = useRef<FileMetadata | null>(null);

  // --- LIFECYCLE & HELPERS ---

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev].slice(0, 50));
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
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

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
            const width = window.innerWidth;
            const size = Math.min(width * 0.7, 250); 
            
            await html5QrCode.start(
              { facingMode: "environment" }, 
              { fps: 15, qrbox: { width: size, height: size }, aspectRatio: 1.0 },
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
        addLog("检测到现有 Peer 连接，正在重用...");
        if (peerRef.current.disconnected) {
            addLog("连接已断开，尝试重连...");
            peerRef.current.reconnect();
        }
        return peerRef.current;
    }
    
    if (typeof window.Peer === 'undefined') {
      const msg = "核心组件(PeerJS)加载失败，请检查网络";
      setErrorMsg(msg);
      addLog(msg);
      setAppState(AppState.ERROR);
      return null;
    }

    try {
      setServerStatus('connecting');
      addLog("正在初始化 P2P 节点 (SSL/TLS)...");
      
      const peerOptions: any = {
        debug: 1,
        secure: true, // CRITICAL for Vercel/HTTPS
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun.miwifi.com' },
            { urls: 'stun:stun.qq.com:3478' }
          ],
          iceCandidatePoolSize: 10,
        }
      };

      const peer = new window.Peer(id, peerOptions);

      peer.on('open', (myId: string) => {
        addLog(`连接信令服务器成功。ID: ${myId}`);
        setPeerId(myId);
        setServerStatus('connected');
        setErrorMsg('');
      });

      peer.on('connection', (conn: any) => {
        addLog(`收到来自 ${conn.peer} 的连接请求`);
        handleConnection(conn);
      });

      peer.on('disconnected', () => {
        addLog("与信令服务器断开连接");
        setServerStatus('disconnected');
      });

      peer.on('close', () => {
        addLog("P2P 节点已关闭");
        setServerStatus('disconnected');
        setPeerId('');
      });

      peer.on('error', (err: any) => {
        addLog(`P2P 错误: ${err.type} - ${err.message}`);
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
        connRef.current.close();
    }
    
    connRef.current = conn;
    addLog("正在建立数据通道...");
    
    conn.on('open', () => {
      addLog(`数据通道已建立! 与 ${conn.peer} 连接成功`);
      setConnectionStatus('Connected');
      setIsConnecting(false); 
      setErrorMsg('');
      setAppState(AppState.CHAT);
      
      if (connectionTimeoutRef.current) {
          clearTimeout(connectionTimeoutRef.current);
          connectionTimeoutRef.current = null;
      }
    });

    conn.on('data', (data: any) => {
      handleIncomingData(data);
    });

    conn.on('close', () => {
      addLog("对方断开了连接");
      setConnectionStatus('Disconnected');
      setIsConnecting(false);
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
    const isBinary = data instanceof ArrayBuffer || 
                     data instanceof Uint8Array || 
                     data instanceof Blob || 
                     (data && data.constructor && data.constructor.name === 'ArrayBuffer') ||
                     (data && data.buffer instanceof ArrayBuffer);
    
    if (isBinary) {
      handleFileChunk(data);
      return;
    }

    // Handle JSON messages
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
          addLog(`开始接收文件: ${meta.name} (${meta.size} bytes)`);
          
          // Use Refs to avoid closure staleness
          currentIncomingMetaRef.current = meta;
          fileMetaRef.current = meta; // Backup
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
                 connRef.current.send({ type: 'ACK_FILE_START' });
             }
          }, 50);
          break;
        
        case 'ACK_FILE_START':
           if (pendingFileTransferRef.current) {
             addLog("对方确认，开始流式传输...");
             streamFile(pendingFileTransferRef.current);
             pendingFileTransferRef.current = null;
           }
           break;
      }
    }
  };

  const handleFileChunk = (data: any) => {
    const meta = currentIncomingMetaRef.current || fileMetaRef.current;
    if (!meta) {
        addLog("收到数据块但无文件元数据，丢弃");
        return;
    }
    
    const chunk = data instanceof Blob ? data : new Blob([data]);
    receivedChunksRef.current.push(chunk);
    receivedSizeRef.current += chunk.size;

    const total = meta.size;
    const progress = Math.round((receivedSizeRef.current / total) * 100);

    // Optimize state updates: only update UI every 5% or when done
    if (progress % 5 === 0 || progress >= 100) {
        setMessages(prev => prev.map(m => {
            if (m.id === meta.id) {
                return { ...m, progress: progress };
            }
            return m;
        }));
    }

    if (receivedSizeRef.current >= total) {
        addLog("文件接收完成，正在合成...");
        const blob = new Blob(receivedChunksRef.current, { type: meta.type });
        const url = URL.createObjectURL(blob);
        
        setMessages(prev => prev.map(m => {
            if (m.id === meta.id) {
                return { ...m, progress: 100, status: 'completed', fileUrl: url };
            }
            return m;
        }));

        // Reset buffers
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
    addLog("创建房间中...");
    
    // Destroy previous peer to ensure clean slate
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }

    try {
      const id = await generateConnectionPhrase();
      addLog(`生成房间 ID: ${id}`);
      initializePeer(id);
    } catch (e: any) {
      addLog(`ID生成失败: ${e.message}`);
      // Fallback
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
    
    // Destroy previous peer
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }
    
    // Auto-generate a local ID for receiver immediately
    // This allows them to come online instantly without waiting for user input
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

  const connectToTarget = (overrideId?: string) => {
    const rawId = typeof overrideId === 'string' ? overrideId : targetPeerId;
    const target = rawId?.trim().toLowerCase(); 
    
    if (!peerRef.current || !peerRef.current.id) {
        setErrorMsg("网络未就绪，请等待服务器连接变绿");
        addLog("尝试连接但本地 Peer 未就绪");
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

    setIsConnecting(true);
    setErrorMsg('');
    addLog(`发起连接 -> 目标: ${target}`);
    
    // Cleanup previous connection attempt
    if (connRef.current) {
        connRef.current.close();
    }
    if (connectionTimeoutRef.current) {
        clearTimeout(connectionTimeoutRef.current);
    }

    // Set timeout
    connectionTimeoutRef.current = setTimeout(() => {
        if (isConnecting) {
             const msg = "连接超时 (15s)。\n1. 请确认口令正确\n2. 确认对方在线且未关闭页面\n3. 尝试点击右上角重置网络";
             setIsConnecting(false);
             setErrorMsg(msg);
             addLog("连接超时");
             if (connRef.current) connRef.current.close();
        }
    }, 15000);

    try {
        const conn = peerRef.current.connect(target, { 
            reliable: true,
            serialization: 'json' // Explicit serialization
        });
        
        if (!conn) {
            throw new Error("连接创建失败(对象为空)");
        }
        
        handleConnection(conn);
    } catch (e: any) {
        console.error("Connect exception:", e);
        setErrorMsg("连接请求异常: " + e.message);
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

  const pendingFileTransferRef = useRef<File | null>(null);

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
      const chunkSize = 16 * 1024; // 16KB chunks are safer for congestion control
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
                    
                    // Throttle UI updates
                    if (progress % 5 === 0 || progress >= 100) {
                        setMessages(prev => prev.map(m => {
                            if (m.fileMeta?.name === file.name && m.sender === 'me' && m.status !== 'completed') {
                                return { ...m, progress: progress };
                            }
                            return m;
                        }));
                    }

                    if (offset < file.size) {
                        // Use requestAnimationFrame for smoother UI, but setTimeout 0 is faster for throughput
                        setTimeout(() => readSlice(offset), 0);
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
    <div className="flex flex-col md:flex-row gap-6 max-w-4xl w-full animate-in fade-in zoom-in duration-500">
      <div 
        onClick={() => { startRoom(); }}
        className="flex-1 group cursor-pointer"
      >
        <div className="glass-panel h-64 rounded-2xl p-8 flex flex-col items-center justify-center border-t-4 border-indigo-500 bg-gradient-to-b from-slate-800 to-slate-900 shadow-2xl shadow-indigo-500/10 hover:shadow-indigo-500/20 transition-all hover:scale-[1.02]">
          <div className="w-16 h-16 rounded-full bg-indigo-500/20 flex items-center justify-center mb-6 group-hover:bg-indigo-500/30 transition-colors">
            {isGeneratingId ? <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" /> : <Wifi className="w-8 h-8 text-indigo-400" />}
          </div>
          <h2 className="text-2xl font-bold mb-2">我要发送</h2>
          <p className="text-slate-400 text-center text-sm">创建房间，生成口令</p>
        </div>
      </div>

      <div 
        onClick={() => { joinRoom(); }}
        className="flex-1 group cursor-pointer"
      >
        <div className="glass-panel h-64 rounded-2xl p-8 flex flex-col items-center justify-center border-t-4 border-emerald-500 bg-gradient-to-b from-slate-800 to-slate-900 shadow-2xl shadow-emerald-500/10 hover:shadow-emerald-500/20 transition-all hover:scale-[1.02]">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6 group-hover:bg-emerald-500/30 transition-colors">
            <Download className="w-8 h-8 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">我要接收</h2>
          <p className="text-slate-400 text-center text-sm">输入口令或扫码连接</p>
        </div>
      </div>
    </div>
  );

  const renderSetup = () => (
    <div className="glass-panel p-8 rounded-2xl max-w-lg w-full animate-in slide-in-from-bottom-4 duration-300 relative">
      <div className="absolute top-4 right-4 flex gap-2">
           <button onClick={() => setShowLogs(!showLogs)} className={`p-1 rounded hover:bg-slate-700 ${showLogs ? 'text-indigo-400' : 'text-slate-500'}`} title="显示/隐藏连接日志">
               <Terminal size={16} />
           </button>
           <button onClick={() => setShowHelp(true)} className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-indigo-400" title="为什么需要连接服务器？">
               <HelpCircle size={16} />
           </button>
      </div>

      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          {role === 'sender' ? <Wifi className="text-indigo-400" /> : <Download className="text-emerald-400" />}
          {role === 'sender' ? '等待连接' : '加入传输'}
        </h2>
        <button onClick={exitChat} className="text-slate-500 hover:text-white transition-colors">
            <X size={24} />
        </button>
      </div>

      {role === 'sender' ? (
        <div className="space-y-6">
           <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 text-center relative overflow-hidden">
            <div className="absolute inset-0 bg-indigo-500/5 z-0"></div>
            <p className="text-xs text-slate-400 mb-2 uppercase tracking-wider font-semibold z-10 relative">您的房间口令</p>
            <div className="flex items-center justify-center gap-2 mb-2 z-10 relative">
                {isGeneratingId ? (
                    <Loader2 className="animate-spin text-white" />
                ) : (
                    <span className="text-3xl font-mono font-bold text-white tracking-tight break-all select-all">
                        {peerId || '...'}
                    </span>
                )}
            </div>
            {peerId && (
                <div className="flex justify-center gap-3 z-10 relative mt-4">
                    <button 
                        onClick={() => {
                            navigator.clipboard.writeText(peerId);
                            const btn = document.getElementById('copy-btn');
                            if(btn) { btn.innerHTML = '已复制'; setTimeout(() => btn.innerHTML = '复制口令', 1000); }
                        }} 
                        className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm transition-colors"
                    >
                        <Copy size={16} /> <span id="copy-btn">复制口令</span>
                    </button>
                    <button 
                        onClick={() => setShowQr(!showQr)} 
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm transition-colors ${showQr ? 'bg-indigo-600 text-white' : 'bg-slate-800 hover:bg-slate-700'}`}
                    >
                        <QrCode size={16} /> 二维码
                    </button>
                </div>
            )}
            {showQr && peerId && (
                <div className="mt-6 flex flex-col items-center animate-in fade-in zoom-in duration-300">
                    <div className="bg-white p-3 rounded-xl shadow-lg">
                        <img src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(peerId)}&bgcolor=ffffff`} alt="QR" className="w-40 h-40 mix-blend-multiply" />
                    </div>
                    <p className="text-xs text-slate-500 mt-2">使用另一台设备的摄像头扫描</p>
                </div>
            )}
           </div>
           
           <div className="flex items-center justify-center gap-3 py-2 text-slate-400">
               <Loader2 className="animate-spin text-indigo-500 w-5 h-5" />
               <span className="text-sm">正在等待接收方加入...</span>
           </div>
        </div>
      ) : (
        <div className="space-y-6">
           {/* Connection readiness check */}
           {!peerId ? (
             <div className="flex flex-col items-center justify-center py-12 space-y-4 text-slate-400 bg-slate-900/30 rounded-xl border border-dashed border-slate-700">
               <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
               <p className="animate-pulse text-sm">正在连接信令服务器...</p>
               <div className="text-xs text-slate-500">连接建立后方可输入</div>
             </div>
           ) : (
             <>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">输入发送方的口令</label>
                  <div className="flex gap-2">
                      <input 
                      type="text" 
                      value={targetPeerId}
                      onChange={(e) => {
                          setTargetPeerId(e.target.value);
                          if(errorMsg) setErrorMsg(''); 
                      }}
                      placeholder="例如：neon-wolf-123"
                      className={`flex-1 bg-slate-900 border ${errorMsg ? 'border-red-500' : 'border-slate-700'} text-white px-4 py-3 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono transition-colors`}
                      />
                      <button onClick={() => setIsScanning(true)} className="px-4 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-slate-200 transition-colors" title="扫码">
                      <ScanLine size={22} />
                      </button>
                  </div>
                </div>
                
                {errorMsg && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3 flex items-start gap-2 animate-in fade-in">
                        <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
                        <div className="text-red-300 text-sm whitespace-pre-wrap">
                            <p className="font-bold mb-1">连接失败</p>
                            {errorMsg}
                            <div className="mt-2 flex gap-3">
                                <button onClick={() => setShowLogs(true)} className="text-red-200 underline text-xs">查看日志</button>
                                <button onClick={reconnectPeer} className="text-red-200 underline text-xs">重置网络</button>
                            </div>
                        </div>
                    </div>
                )}

                <Button 
                  onClick={() => connectToTarget()} 
                  variant="primary" 
                  isLoading={isConnecting}
                  className="w-full !bg-emerald-600 hover:!bg-emerald-500 shadow-emerald-500/20"
                  icon={<ArrowRight size={18} />}
                >
                  {isConnecting ? '正在连接...' : '立即连接'}
                </Button>
             </>
           )}
        </div>
      )}

      {/* DEBUG LOGS OVERLAY */}
      {showLogs && (
        <div className="mt-4 bg-slate-950 p-3 rounded-lg border border-slate-800 text-[10px] font-mono text-green-400/80 h-32 overflow-y-auto">
            <div className="flex justify-between sticky top-0 bg-slate-950 pb-1 mb-1 border-b border-slate-800">
                <span className="font-bold text-slate-400">连接日志 (Diagnostics)</span>
                <span className="cursor-pointer text-slate-500 hover:text-white" onClick={() => setLogs([])}>清空</span>
            </div>
            {logs.length === 0 ? <span className="opacity-50">暂无日志...</span> : logs.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* QR SCANNER FULLSCREEN OVERLAY */}
      {isScanning && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center">
            <div className="absolute top-0 w-full p-6 flex justify-between z-20 bg-gradient-to-b from-black/80 to-transparent">
                <div className="text-white font-bold flex gap-2 items-center"><Camera size={20} /> 扫描二维码</div>
                <button onClick={stopScanner} className="bg-white/20 hover:bg-white/30 p-2 rounded-full text-white transition-colors"><X size={24} /></button>
            </div>
            <div id="reader" className="w-full h-full object-cover"></div>
            
            <div className="absolute pointer-events-none inset-0 flex items-center justify-center z-10">
                <div className="w-64 h-64 border-2 border-emerald-400/50 rounded-2xl relative">
                    <div className="absolute top-0 left-0 w-full h-0.5 bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,1)] animate-[scan_2.5s_linear_infinite]"></div>
                </div>
            </div>
            <div className="absolute bottom-12 text-center w-full z-20">
                <p className="text-white/90 bg-black/60 inline-block px-6 py-2 rounded-full backdrop-blur-md border border-white/10">请将发送方的二维码对准框内</p>
            </div>
        </div>
      )}
    </div>
  );

  const renderChat = () => (
    <div className="w-full max-w-2xl h-[85vh] flex flex-col glass-panel rounded-2xl overflow-hidden shadow-2xl shadow-black/50 animate-in fade-in zoom-in duration-300 border border-slate-700">
      {/* CHAT HEADER */}
      <div className="p-4 bg-slate-900/90 border-b border-slate-700 flex justify-between items-center backdrop-blur-md">
         <div className="flex items-center gap-3">
             <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold shadow-lg ${role === 'sender' ? 'bg-indigo-500 shadow-indigo-500/20' : 'bg-emerald-500 shadow-emerald-500/20'}`}>
                 {role === 'sender' ? <Wifi size={20} /> : <Download size={20} />}
             </div>
             <div>
                 <h3 className="font-bold text-white leading-tight">加密传输通道</h3>
                 <div className="flex items-center gap-1.5">
                     <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                     <span className="text-xs text-emerald-400 font-medium">连接稳定 • {connectionStatus}</span>
                 </div>
             </div>
         </div>
         <button onClick={exitChat} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-red-400 transition-colors" title="断开连接">
             <X size={20} />
         </button>
      </div>

      {/* CHAT MESSAGES AREA */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth bg-slate-950/30">
          {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full opacity-60">
                  <ShieldCheck className="w-16 h-16 text-slate-600 mb-4" />
                  <p className="text-slate-400 font-medium">连接已建立</p>
                  <p className="text-slate-500 text-sm mt-1">所有数据均通过 P2P 加密直连</p>
              </div>
          )}
          
          {messages.map((msg) => {
              const isMe = msg.sender === 'me';
              return (
                  <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} animate-in slide-in-from-bottom-2`}>
                      <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl p-3 shadow-md ${
                          isMe 
                          ? 'bg-indigo-600 text-white rounded-br-sm' 
                          : 'bg-slate-700 text-slate-100 rounded-bl-sm'
                      }`}>
                          {/* Text Content */}
                          {msg.type === 'text' && <p className="break-words leading-relaxed whitespace-pre-wrap">{msg.content}</p>}

                          {/* File Content */}
                          {msg.type === 'file' && (
                              <div className="w-full sm:w-64">
                                  <div className="flex items-center gap-3 mb-3">
                                      <div className={`p-2.5 rounded-xl ${isMe ? 'bg-indigo-500' : 'bg-slate-600'}`}>
                                          <FileIcon size={24} className="text-white" />
                                      </div>
                                      <div className="overflow-hidden min-w-0">
                                          <p className="font-medium truncate text-sm" title={msg.fileMeta?.name}>{msg.fileMeta?.name}</p>
                                          <p className="text-xs opacity-70">
                                              {((msg.fileMeta?.size || 0) / (1024 * 1024)).toFixed(2)} MB
                                          </p>
                                      </div>
                                  </div>
                                  
                                  {/* Progress or Actions */}
                                  {msg.status === 'completed' ? (
                                      isMe ? (
                                        <div className="text-xs flex items-center justify-end gap-1 opacity-80 font-medium bg-black/10 py-1 px-2 rounded-md"><CheckCircle size={12} /> 发送成功</div>
                                      ) : (
                                        <a href={msg.fileUrl} download={msg.fileMeta?.name} className="block w-full">
                                            <button className="w-full bg-emerald-500 hover:bg-emerald-400 text-white py-2 rounded-lg text-sm font-bold transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20">
                                                <Download size={16} /> 下载文件
                                            </button>
                                        </a>
                                      )
                                  ) : (
                                      <div className="space-y-1.5 bg-black/10 p-2 rounded-lg">
                                          <div className="flex justify-between text-xs font-medium">
                                              <span className="opacity-80">{msg.sender === 'me' ? '正在发送...' : '正在接收...'}</span>
                                              <span>{msg.progress}%</span>
                                          </div>
                                          <ProgressBar progress={msg.progress || 0} heightClass="h-2" colorClass={isMe ? "bg-white/90" : "bg-emerald-500"} />
                                      </div>
                                  )}
                              </div>
                          )}
                          
                          <div className={`text-[10px] mt-1 text-right font-medium opacity-60`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                      </div>
                  </div>
              )
          })}
          <div ref={messagesEndRef} />
      </div>

      {/* INPUT AREA */}
      <div className="p-4 bg-slate-900/80 border-t border-slate-700 backdrop-blur-md z-10">
          <div className="flex items-end gap-2 bg-slate-800/50 p-2 rounded-xl border border-slate-700/50 focus-within:border-indigo-500/50 focus-within:bg-slate-800 transition-all">
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
                  className={`p-2.5 rounded-lg transition-colors shrink-0 mb-0.5 ${isTransferring ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-700 text-slate-400 hover:text-white bg-slate-700/30'}`}
                  title="发送文件"
              >
                  <Paperclip size={20} />
              </button>
              
              <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={isTransferring ? "文件传输中，文本发送暂时禁用..." : "输入消息..."}
                  disabled={isTransferring}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 resize-none max-h-32 py-3 min-h-[44px] text-sm sm:text-base"
                  rows={1}
                  style={{ height: 'auto', minHeight: '44px' }}
              />
              
              <button 
                  onClick={sendMessage}
                  disabled={!inputText.trim() || isTransferring}
                  className={`p-3 rounded-xl mb-0.5 transition-all shrink-0 ${
                      !inputText.trim() || isTransferring 
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/30 active:scale-95'
                  }`}
              >
                  {isTransferring ? <Loader2 size={20} className="animate-spin" /> : <ArrowUpCircle size={20} />}
              </button>
          </div>
          {isTransferring && <div className="text-center mt-2 flex items-center justify-center gap-2 text-xs text-amber-500 font-medium bg-amber-500/10 py-1 rounded-md"><AlertTriangle size={12}/> 文件传输期间请保持页面开启，不要切换网络</div>}
      </div>
    </div>
  );

  const CheckCircle = ({size = 16}) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
  );

  return (
    <div className="min-h-screen flex flex-col items-center relative overflow-hidden bg-slate-950 font-sans selection:bg-indigo-500/30">
       {/* Connection Status Indicator (Global) */}
       <div className="absolute top-4 right-4 z-50 flex gap-2 items-center">
            {serverStatus === 'connecting' && <div className="bg-yellow-500/20 border border-yellow-500/30 text-yellow-500 text-xs px-2 py-1 rounded-full flex items-center gap-1 backdrop-blur-md shadow-lg"><Loader2 size={12} className="animate-spin"/> 服务器连接中...</div>}
            {serverStatus === 'disconnected' && appState !== AppState.HOME && (
                <button onClick={reconnectPeer} className="bg-red-500/20 border border-red-500/30 text-red-500 text-xs px-2 py-1 rounded-full flex items-center gap-1 backdrop-blur-md shadow-lg hover:bg-red-500/30 transition-colors">
                    <Activity size={12}/> 服务器离线 (点击重连)
                </button>
            )}
            {serverStatus === 'connected' && appState !== AppState.HOME && (
                 <div className="bg-emerald-500/20 border border-emerald-500/30 text-emerald-500 text-xs px-2 py-1 rounded-full flex items-center gap-1 backdrop-blur-md shadow-lg">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div> 服务器已连接
                 </div>
            )}
       </div>

       {/* HELP MODAL */}
       {showHelp && (
           <div className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowHelp(false)}>
               <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl max-w-md w-full shadow-2xl" onClick={e => e.stopPropagation()}>
                   <div className="flex justify-between items-center mb-4">
                       <h3 className="text-xl font-bold flex items-center gap-2"><Server className="text-indigo-400" size={24}/> 为什么 P2P 需要服务器？</h3>
                       <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-white"><X size={24}/></button>
                   </div>
                   <div className="space-y-4 text-slate-300 text-sm leading-relaxed">
                       <p>这是一个极好的问题。虽然 P2P（Peer-to-Peer）意味着“设备到设备”的直接传输，但在建立连接之前，您的设备需要“找到”对方。</p>
                       
                       <div className="bg-slate-800/50 p-3 rounded-lg">
                           <strong className="text-white block mb-1">1. 信令服务器 (Signaling)</strong>
                           <p>就像打电话需要查电话簿一样，两台设备需要一个中间人来交换 IP 地址。一旦交换完成，服务器就会“退场”，数据直接在两台设备间传输。</p>
                       </div>

                       <div className="bg-slate-800/50 p-3 rounded-lg">
                           <strong className="text-white block mb-1">2. 打洞服务器 (STUN)</strong>
                           <p>大多数电脑都在路由器（WiFi）后面。STUN 服务器帮助您的电脑“看清”自己的公网地址，从而穿透防火墙。</p>
                       </div>
                       
                       <p className="text-xs text-emerald-400 font-bold mt-2 flex items-center gap-1">
                           <ShieldCheck size={14}/> 您的文件绝对不会上传到任何服务器。
                       </p>
                   </div>
                   <button onClick={() => setShowHelp(false)} className="w-full mt-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg font-bold">我明白了</button>
               </div>
           </div>
       )}

       {/* Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-indigo-900/10 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-emerald-900/5 rounded-full blur-[100px]"></div>
      </div>

      <header className={`w-full text-center z-10 transition-all duration-700 ${appState === AppState.HOME ? 'py-12 opacity-100' : 'py-4 opacity-100'}`}>
        {appState === AppState.HOME ? (
            <div className="animate-in fade-in slide-in-from-top-4 duration-700">
                <div className="inline-flex items-center gap-3 mb-4 bg-slate-900/50 px-5 py-2 rounded-full border border-slate-800 backdrop-blur-sm">
                    <Zap className="text-yellow-400 w-5 h-5" fill="currentColor" />
                    <span className="text-slate-300 font-medium tracking-wide text-sm">P2P 安全直连 • 极速传输</span>
                </div>
                <h1 className="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 mb-6 tracking-tight">
                    Nexus<span className="text-indigo-500">Drop</span>
                </h1>
                <p className="text-lg text-slate-400 max-w-2xl mx-auto px-6">
                    无需登录，不限文件大小，设备间点对点极速互传。
                </p>
            </div>
        ) : (
            <h1 className="text-xl font-bold text-slate-500 tracking-tight cursor-pointer hover:text-slate-300 transition-colors" onClick={() => { if(confirm('确定返回首页？当前连接将断开')) window.location.reload() }}>
                Nexus<span className="text-indigo-900/50">Drop</span>
            </h1>
        )}
      </header>

      <main className="flex-1 flex flex-col items-center justify-center w-full px-4 z-10 pb-10">
        {appState === AppState.HOME && renderHome()}
        {appState === AppState.SETUP && renderSetup()}
        {appState === AppState.CHAT && renderChat()}
        {appState === AppState.ERROR && (
            <div className="glass-panel p-8 rounded-2xl max-w-md w-full text-center border border-red-500/30 shadow-2xl shadow-red-500/10">
                <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                    <AlertTriangle className="w-10 h-10 text-red-500" />
                </div>
                <h3 className="text-xl font-bold text-red-400 mb-2">出错了</h3>
                <p className="text-slate-300 mb-6 leading-relaxed">{errorMsg}</p>
                <Button variant="secondary" onClick={() => window.location.reload()}>刷新页面重试</Button>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;