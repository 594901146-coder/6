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
  CheckCheck,
  Smartphone,
  Maximize,
  Minimize,
  Sun,
  Moon,
  Type
} from 'lucide-react';

// --- ICONS ---

const NexusLogo = ({ className = "", size = 40 }: { className?: string, size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={`${className} drop-shadow-sm`}>
    <defs>
      <linearGradient id="nexus-grad" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#6366f1" /> {/* Indigo-500 */}
        <stop offset="100%" stopColor="#a855f7" /> {/* Purple-500 */}
      </linearGradient>
    </defs>
    <path 
      fillRule="evenodd" 
      clipRule="evenodd" 
      d="M20 2C20 2 6 16.5 6 24.5C6 32.232 12.268 38.5 20 38.5C27.732 38.5 34 32.232 34 24.5C34 16.5 20 2 20 2ZM20 29C22.4853 29 24.5 26.9853 24.5 24.5C24.5 22.0147 22.4853 20 20 20C17.5147 20 15.5 22.0147 15.5 24.5C15.5 26.9853 17.5147 29 20 29Z" 
      fill="url(#nexus-grad)" 
    />
  </svg>
);

// Main Component
const App: React.FC = () => {
  // --- STATE ---
  const [appState, setAppState] = useState<AppState>(AppState.HOME);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('theme');
        return (saved === 'light' || saved === 'dark') ? saved : 'dark';
    }
    return 'dark';
  });
  
  // Connection Setup
  const [role, setRole] = useState<'sender' | 'receiver' | null>(null);
  const [peerId, setPeerId] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<string>('Disconnected');
  const [serverStatus, setServerStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  // UX State
  const [isGeneratingId, setIsGeneratingId] = useState(false);
  const [showTextCode, setShowTextCode] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  
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
  const lastPongRef = useRef<number>(0); // Track last pong time
  const wakeLockRef = useRef<any>(null); // Screen Wake Lock

  // Buffer Refs for Receiving
  const incomingFileIdRef = useRef<string | null>(null);
  const receivedChunksRef = useRef<BlobPart[]>([]);
  const receivedSizeRef = useRef<number>(0);
  const currentIncomingMetaRef = useRef<FileMetadata | null>(null);
  const fileMetaRef = useRef<FileMetadata | null>(null);
  const pendingFileTransferRef = useRef<File | null>(null);
  
  // UI Throttling Refs
  const lastProgressUpdateRef = useRef<number>(0);

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

  // Handle Theme Change
  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') {
        root.classList.add('dark');
    } else {
        root.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => {
      setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stopHeartbeat();
      releaseWakeLock();
      if (scannerRef.current) scannerRef.current.stop().catch(() => {});
      if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

  // --- FULLSCREEN LOGIC ---
  
  // Monitor fullscreen change events
  useEffect(() => {
      const handleFSChange = () => {
          setIsFullscreen(!!document.fullscreenElement);
      };
      document.addEventListener('fullscreenchange', handleFSChange);
      return () => document.removeEventListener('fullscreenchange', handleFSChange);
  }, []);

  const toggleFullScreen = () => {
    const doc = window.document as any;
    const docEl = document.documentElement as any;

    if (!document.fullscreenElement) {
        // Request Fullscreen
        const requestFS = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
        if (requestFS) {
            requestFS.call(docEl).catch((err: any) => {
                console.log("Fullscreen request denied", err);
            });
        }
    } else {
        // Exit Fullscreen
        const exitFS = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
        if (exitFS) {
            exitFS.call(doc);
        }
    }
  };

  const attemptAutoFullScreen = () => {
    if (window.innerWidth < 768 && !document.fullscreenElement) {
        toggleFullScreen();
    }
  };

  // --- WAKE LOCK & VISIBILITY HANDLING ---
  
  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        addLog("💡 屏幕常亮锁已激活");
      } catch (err: any) {
        console.warn(`Wake Lock Error: ${err.name}, ${err.message}`);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
        wakeLockRef.current = null;
        addLog("💡 屏幕常亮锁已释放");
      } catch (err) {
        console.warn("Wake Lock release error", err);
      }
    }
  };

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (isTransferring) {
           addLog("⚠️ 警告: 浏览器已切换至后台，传输可能会中断！");
        }
      } else {
        if (isTransferring) {
           addLog("应用回到前台，检查连接状态...");
           if (!connRef.current || !connRef.current.open) {
               addLog("❌ 发现连接在后台已断开");
               setMessages(prev => prev.map(m => {
                   if (m.status === 'transferring') {
                       return { ...m, status: 'error' };
                   }
                   return m;
               }));
               setIsTransferring(false);
               releaseWakeLock();
               alert("传输中断：因为应用切换到了后台，连接已断开。");
           }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isTransferring]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isTransferring) {
        e.preventDefault();
        e.returnValue = ''; 
        return '当前正在传输文件，确定要退出吗？';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isTransferring]);

  // --- HEARTBEAT & HEALTH CHECK ---
  const startHeartbeat = () => {
    stopHeartbeat();
    lastPongRef.current = Date.now();
    
    heartbeatRef.current = setInterval(() => {
      // 1. Send PING
      if (connRef.current && connRef.current.open) {
        try {
            connRef.current.send({ type: 'PING' });
        } catch (e) {
            console.warn("Heartbeat send failed", e);
        }
      }

      // 2. Check PONG timeout
      const timeSinceLastPong = Date.now() - lastPongRef.current;
      if (timeSinceLastPong > 10000 && connectionStatus === 'Connected') {
          addLog("❌ 心跳超时 (10s)，判定对方已掉线");
          setConnectionStatus('Disconnected');
          // Optional: Attempt auto-reconnect logic here if needed
      }
    }, 4000); 
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
            setErrorMsg("扫码组件未加载，请检查网络");
            addLog("Error: Html5Qrcode is undefined");
            setIsScanning(false);
            return;
          }
          try {
            const html5QrCode = new window.Html5Qrcode("reader");
            scannerRef.current = html5QrCode;
            
            const aspectRatio = window.innerWidth / window.innerHeight;

            const config = { 
              fps: 15, 
              qrbox: { width: 250, height: 250 }, 
              aspectRatio: aspectRatio, 
              disableFlip: false,
              videoConstraints: {
                  facingMode: "environment",
                  aspectRatio: aspectRatio,
                  width: { min: 640, ideal: 1280, max: 1920 },
                  height: { min: 480, ideal: 720, max: 1080 },
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
                  const cleanId = decodedText.split('/').pop() || decodedText;
                  connectToTarget(cleanId);
                }
              },
              (errorMessage: string) => {} 
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
      const msg = "PeerJS 组件尚未加载完成，请检查网络连接 (CDN)";
      setErrorMsg(msg);
      addLog("CRITICAL ERROR: window.Peer is undefined");
      setShowLogs(true);
      return null;
    }

    try {
      setServerStatus('connecting');
      addLog(`正在初始化 P2P 节点 (ID: ${id || '自动生成'})...`);
      
      const isSecure = window.location.protocol === 'https:';

      const peer = new window.Peer(id, {
        debug: 1,
        secure: isSecure, 
        config: {
          iceServers: [
             { urls: 'stun:stun.chat.bilibili.com:3478' },
             { urls: 'stun:stun.miwifi.com' },
             { urls: 'stun:stun.qq.com:3478' },
             { urls: 'stun:stun.l.google.com:19302' }
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
        // Do NOT set connectionStatus to Disconnected here. 
        // P2P might still be alive. Heartbeat will check that.
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
        else if (err.type === 'browser-incompatible') msg = "您的浏览器不支持 WebRTC";
        
        setErrorMsg(msg);
        setShowLogs(true);
      });

      peerRef.current = peer;
      return peer;
    } catch (e: any) {
      addLog(`初始化异常: ${e.message}`);
      setErrorMsg("初始化失败: " + e.message);
      setAppState(AppState.ERROR);
      setShowLogs(true);
      return null;
    }
  }, []);

  const handleConnection = (conn: any) => {
    if (connRef.current) {
        addLog("关闭旧连接，接受新连接...");
        connRef.current.close();
    }
    
    connRef.current = conn;
    
    conn.on('open', () => {
      addLog(`✅ 数据通道已打开! 对方: ${conn.peer}`);
      conn.send({ type: 'PING' });
      lastPongRef.current = Date.now(); // Reset pong timer
      startHeartbeat();
    });

    conn.on('data', (data: any) => {
      if (data && data.type === 'PING') {
          conn.send({ type: 'PONG' });
          return;
      }
      if (data && data.type === 'PONG') {
          lastPongRef.current = Date.now(); // Alive!
          if (connectionStatus !== 'Connected') {
              addLog(`🤝 连接握手确认成功！`);
              setConnectionStatus('Connected');
              setIsConnecting(false);
              setErrorMsg('');
              setAppState(AppState.CHAT);
              attemptAutoFullScreen(); 
          }
          return;
      }

      handleIncomingData(data);
    });

    conn.on('close', () => {
      addLog("对方断开了连接");
      setConnectionStatus('Disconnected');
      setIsConnecting(false);
      setIsTransferring(false);
      releaseWakeLock();
      stopHeartbeat();
      addSystemMessage("对方已断开连接");
    });
    
    conn.on('error', (err: any) => {
      addLog(`连接错误: ${err}`);
      setIsConnecting(false);
      setConnectionStatus('Disconnected');
      setIsTransferring(false);
      releaseWakeLock();
      addSystemMessage("连接发生错误");
    });
  };

  // --- DATA HANDLING ---
  
  const handleIncomingData = (data: any) => {
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
          lastProgressUpdateRef.current = 0;
          
          setIsTransferring(true);
          requestWakeLock(); 

          setMessages(prev => [...prev, {
            id: meta.id, 
            sender: 'peer',
            type: 'file',
            fileMeta: meta,
            progress: 0,
            status: 'transferring',
            timestamp: Date.now()
          }]);
          
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
    try {
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
        const progress = Math.min(Math.round((receivedSizeRef.current / total) * 100), 100);
        const now = Date.now();

        if (now - lastProgressUpdateRef.current > 100 || progress >= 100) {
            lastProgressUpdateRef.current = now;
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
            releaseWakeLock(); 
        }
    } catch (e) {
        console.error("Chunk processing error", e);
        addLog("Data chunk error");
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

  const waitForPeerJS = async (): Promise<boolean> => {
      if (typeof window.Peer !== 'undefined') return true;
      addLog("等待 PeerJS 加载...");
      for (let i = 0; i < 20; i++) { 
          await new Promise(r => setTimeout(r, 100));
          if (typeof window.Peer !== 'undefined') {
              addLog("PeerJS 加载完成");
              return true;
          }
      }
      return false;
  };

  const resetToHome = useCallback(() => {
     addLog("正在断开连接并返回首页...");
     if(connRef.current) {
         connRef.current.close();
         connRef.current = null;
     }
     if(peerRef.current) {
         peerRef.current.destroy();
         peerRef.current = null;
     }
     if(scannerRef.current) {
         scannerRef.current.stop().catch(() => {});
         scannerRef.current = null;
     }
     stopHeartbeat();
     releaseWakeLock();
     if(connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
     
     setAppState(AppState.HOME);
     setRole(null);
     setPeerId('');
     setTargetPeerId('');
     setConnectionStatus('Disconnected');
     setServerStatus('disconnected');
     setErrorMsg('');
     setMessages([]);
     setIsConnecting(false);
     setIsTransferring(false);
     setRetryCount(0);
     setIsGeneratingId(false);
     setShowTextCode(false); 
     setIsScanning(false);
  }, []);

  const startRoom = async () => {
    attemptAutoFullScreen();
    setAppState(AppState.SETUP); 
    setRole('sender');
    setIsGeneratingId(true);
    setShowTextCode(false); 
    setErrorMsg('');
    setLogs([]); 
    
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }

    const ready = await waitForPeerJS();
    if (!ready) {
        setErrorMsg("核心组件加载超时，请刷新页面");
        setIsGeneratingId(false);
        return;
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

  const joinRoom = async () => {
    attemptAutoFullScreen();
    setAppState(AppState.SETUP);
    setRole('receiver');
    setErrorMsg('');
    setLogs([]); 
    addLog("初始化接收端...");
    
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }
    
    const ready = await waitForPeerJS();
    if (!ready) {
        setErrorMsg("核心组件加载超时，请刷新页面");
        return;
    }

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
    if (!isRetry) attemptAutoFullScreen();

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
    
    if (connRef.current) connRef.current.close();
    if (connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);

    try {
        const conn = peerRef.current.connect(target, { 
            reliable: true 
        });
        
        if (!conn) throw new Error("连接对象创建失败");
        
        handleConnection(conn);

        connectionTimeoutRef.current = setTimeout(() => {
            if (isConnecting && connectionStatus !== 'Connected') {
                 addLog("连接超时 (10s)");
                 
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
        }, 8000); 

    } catch (e: any) {
        console.error("Connect exception:", e);
        setErrorMsg("连接异常: " + e.message);
        addLog("连接异常: " + e.message);
        setIsConnecting(false);
    }
  };

  const sendMessage = () => {
    if (!inputText.trim()) return;
    
    if (!connRef.current) {
        alert("错误：P2P 连接对象不存在");
        return;
    }
    
    if (!connRef.current.open) {
        addLog("尝试发送消息，但连接状态未 OPEN");
        alert("连接似乎已断开，无法发送消息");
    }
    
    try {
        connRef.current.send({ type: 'TEXT', payload: inputText });
        
        setMessages(prev => [...prev, {
            id: Date.now().toString(),
            sender: 'me',
            type: 'text',
            content: inputText,
            timestamp: Date.now()
        }]);
        
        setInputText('');
    } catch (e: any) {
        console.error("Send message failed", e);
        alert(`发送失败: ${e.message}`);
        addLog(`发送文本失败: ${e.message}`);
    }
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
        requestWakeLock(); 
        e.target.value = '';
    }
  };

  const streamFile = async (file: File) => {
      const chunkSize = 64 * 1024; 
      let offset = 0;
      let lastUpdate = 0;
      
      try {
          while (offset < file.size) {
              if (!connRef.current || !connRef.current.open) {
                  throw new Error("传输中断：连接已关闭");
              }

              const channel = connRef.current.dataChannel;
              if (channel && channel.bufferedAmount > 16 * 1024 * 1024) {
                  await new Promise(r => setTimeout(r, 50));
                  continue;
              }

              const slice = file.slice(offset, offset + chunkSize);
              const buffer = await slice.arrayBuffer();
              
              connRef.current.send(buffer);
              offset += chunkSize;

              const now = Date.now();
              if (now - lastUpdate > 100 || offset >= file.size) {
                  lastUpdate = now;
                  const progress = Math.min((offset / file.size) * 100, 100);
                  
                  setMessages(prev => prev.map(m => {
                      if (m.fileMeta?.name === file.name && m.sender === 'me' && m.status !== 'completed' && m.status !== 'error') {
                          return { ...m, progress: progress };
                      }
                      return m;
                  }));
              }
              
              await new Promise(r => setTimeout(r, 0));
          }

          if (offset >= file.size) {
              addLog("文件发送完成");
              setMessages(prev => prev.map(m => {
                  if (m.fileMeta?.name === file.name && m.sender === 'me') {
                      return { ...m, progress: 100, status: 'completed' };
                  }
                  return m;
              }));
          }

      } catch (err: any) {
          console.error("Stream error", err);
          addLog("发送中断: " + err.message);
          addSystemMessage(`文件 ${file.name} 发送失败: ${err.message}`);
          
          setMessages(prev => prev.map(m => {
            if (m.fileMeta?.name === file.name && m.sender === 'me') {
                return { ...m, status: 'error' };
            }
            return m;
          }));
      } finally {
          setIsTransferring(false);
          releaseWakeLock();
      }
  };

  const renderHome = () => (
    <div className="flex flex-col md:flex-row gap-6 md:gap-8 max-w-5xl w-full animate-in fade-in slide-in-from-bottom-8 duration-700 items-center justify-center">
      <div 
        onClick={() => { startRoom(); }}
        className="group cursor-pointer relative w-full md:w-[420px]"
      >
        <div className="absolute inset-0 bg-indigo-500/20 blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-full"></div>
        <div className="glass-panel w-full md:min-h-[360px] rounded-[30px] md:rounded-[40px] p-8 flex flex-col items-center justify-center md:justify-start text-center border border-slate-200 dark:border-white/5 bg-gradient-to-br from-white/80 to-slate-100/80 dark:from-slate-900/80 dark:to-slate-950/80 hover:border-indigo-500/50 shadow-2xl transition-all duration-300 hover:-translate-y-2 group-hover:shadow-[0_0_40px_rgba(99,102,241,0.2)]">
          <div className="w-16 h-16 md:w-24 md:h-24 mb-4 md:mb-6 rounded-full bg-indigo-50 dark:bg-indigo-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 border border-indigo-100 dark:border-indigo-500/20 shrink-0">
             <Wifi className="w-8 h-8 md:w-12 md:h-12 text-indigo-500" />
          </div>
          <h2 className="text-xl md:text-3xl font-bold text-slate-800 dark:text-white mb-2 md:mb-4">我要发送</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base leading-relaxed mb-4 md:mb-8">
              创建加密房间，生成口令分享给接收方。
          </p>
          <div className="hidden md:flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-bold text-sm md:text-base group-hover:translate-x-1 transition-transform">
              创建房间 <ArrowRight size={20} />
          </div>
        </div>
      </div>

      <div 
        onClick={() => { joinRoom(); }}
        className="group cursor-pointer relative w-full md:w-[420px]"
      >
        <div className="absolute inset-0 bg-emerald-500/20 blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-full"></div>
        <div className="glass-panel w-full md:min-h-[360px] rounded-[30px] md:rounded-[40px] p-8 flex flex-col items-center justify-center md:justify-start text-center border border-slate-200 dark:border-white/5 bg-gradient-to-br from-white/80 to-slate-100/80 dark:from-slate-900/80 dark:to-slate-950/80 hover:border-emerald-500/50 shadow-2xl transition-all duration-300 hover:-translate-y-2 group-hover:shadow-[0_0_40px_rgba(16,185,129,0.2)]">
          <div className="w-16 h-16 md:w-24 md:h-24 mb-4 md:mb-6 rounded-full bg-emerald-50 dark:bg-emerald-500/10 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 border border-emerald-100 dark:border-emerald-500/20 shrink-0">
            <Download className="w-8 h-8 md:w-12 md:h-12 text-emerald-500" />
          </div>
          <h2 className="text-xl md:text-3xl font-bold text-slate-800 dark:text-white mb-2 md:mb-4">我要接收</h2>
          <p className="text-slate-500 dark:text-slate-400 text-sm md:text-base leading-relaxed mb-4 md:mb-8">
              输入口令或扫描二维码，建立安全连接。
          </p>
          <div className="hidden md:flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-sm md:text-base group-hover:translate-x-1 transition-transform">
              加入连接 <ArrowRight size={20} />
          </div>
        </div>
      </div>
    </div>
  );

  const renderSetup = () => (
    <div className="glass-panel p-6 md:p-8 rounded-[40px] max-w-lg w-full animate-in slide-in-from-bottom-8 duration-500 relative border border-slate-200 dark:border-white/10 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.5)] bg-white/60 dark:bg-slate-900/60 backdrop-blur-2xl">
      <div className="flex justify-between items-start mb-6 md:mb-8">
        <div className="flex items-center gap-3 md:gap-4">
             <div className={`p-2.5 md:p-3 rounded-2xl ${role === 'sender' ? 'bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-500 dark:text-indigo-400' : 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-500 dark:text-emerald-400'}`}>
                {role === 'sender' ? <Wifi size={20} className="md:w-6 md:h-6" /> : <Download size={20} className="md:w-6 md:h-6" />}
             </div>
             <div>
                 <h2 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-white leading-none mb-1">{role === 'sender' ? '等待连接' : '加入传输'}</h2>
                 <p className="text-xs md:text-sm text-slate-500 dark:text-slate-400">{role === 'sender' ? '分享下方口令' : '连接到发送方'}</p>
             </div>
        </div>

        <div className="flex items-center gap-1 bg-slate-200/60 dark:bg-slate-800/60 p-1 rounded-full border border-slate-300/50 dark:border-white/5 backdrop-blur-sm">
           <button onClick={() => setShowLogs(!showLogs)} className={`p-2 rounded-full transition-colors ${showLogs ? 'text-indigo-500 dark:text-indigo-400 bg-indigo-500/10 dark:bg-indigo-500/20' : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10'}`} title="查看系统日志">
               <Terminal size={16} className="md:w-[18px] md:h-[18px]" />
           </button>
           <div className="w-px h-4 bg-slate-400/30 dark:bg-white/10 mx-0.5"></div>
           <button onClick={() => setShowHelp(true)} className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors" title="核心技术原理">
               <Sparkles size={16} className="md:w-[18px] md:h-[18px]" />
           </button>
           <div className="w-px h-4 bg-slate-400/30 dark:bg-white/10 mx-0.5"></div>
           <button onClick={resetToHome} className="p-2 rounded-full text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 transition-colors" title="返回首页">
               <X size={16} className="md:w-[18px] md:h-[18px]" />
           </button>
        </div>
      </div>

      {role === 'sender' ? (
        <div className="space-y-6">
           <div className="bg-slate-100 dark:bg-slate-950/50 p-8 rounded-[30px] border border-dashed border-slate-300 dark:border-slate-700 text-center relative group transition-colors flex flex-col items-center justify-center min-h-[320px]">
             <div className="absolute inset-0 bg-indigo-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-[30px]"></div>
             
             {isGeneratingId ? (
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="animate-spin text-slate-400 dark:text-white w-10 h-10" />
                    <p className="text-sm text-slate-400 dark:text-slate-500 animate-pulse">正在创建加密房间...</p>
                </div>
             ) : (
                <>
                  {!showTextCode ? (
                    <div className="flex flex-col items-center animate-in fade-in zoom-in duration-300">
                        <div className="bg-white p-4 rounded-3xl shadow-sm border border-slate-200 mb-6">
                            <img src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(peerId)}&bgcolor=ffffff`} alt="QR" className="w-48 h-48 md:w-56 md:h-56 mix-blend-multiply" />
                        </div>
                        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">使用另一台设备扫描连接</p>
                        <button 
                            onClick={() => setShowTextCode(true)}
                            className="flex items-center gap-2 px-6 py-3 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-full text-sm font-bold transition-all border border-slate-300 dark:border-slate-700"
                        >
                            <Type size={18} /> 显示文字口令
                        </button>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center w-full animate-in fade-in zoom-in duration-300">
                        <p className="text-xs text-indigo-500 dark:text-indigo-400 mb-4 uppercase tracking-widest font-bold">ROOM CODE</p>
                        <span className="text-4xl md:text-5xl font-mono font-bold text-slate-900 dark:text-white tracking-tight mb-8 drop-shadow-sm select-all break-all text-center">
                            {peerId || '...'}
                        </span>
                        <div className="flex flex-col md:flex-row gap-3 w-full justify-center">
                            <button 
                                onClick={() => {
                                    navigator.clipboard.writeText(peerId);
                                    const btn = document.getElementById('copy-btn');
                                    if(btn) { btn.innerHTML = '已复制'; setTimeout(() => btn.innerHTML = '复制口令', 1000); }
                                }} 
                                className="flex items-center justify-center gap-2 px-8 py-3 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full text-sm font-bold transition-all shadow-lg shadow-indigo-500/25"
                            >
                                <Copy size={18} /> <span id="copy-btn">复制口令</span>
                            </button>
                            <button 
                                onClick={() => setShowTextCode(false)} 
                                className="flex items-center justify-center gap-2 px-8 py-3 rounded-full text-sm font-bold transition-all border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                            >
                                <QrCode size={18} /> 二维码
                            </button>
                        </div>
                    </div>
                  )}
                </>
             )}
           </div>
           
           <div className="flex items-center justify-center gap-3 py-2 text-slate-500 dark:text-slate-400 bg-slate-200/50 dark:bg-slate-800/30 rounded-full px-6 w-fit mx-auto border border-slate-300/50 dark:border-slate-700/50">
               <div className="relative">
                 <div className="w-3 h-3 bg-indigo-500 rounded-full animate-ping absolute opacity-75"></div>
                 <div className="w-3 h-3 bg-indigo-500 rounded-full relative"></div>
               </div>
               <span className="text-sm font-medium">正在等待接收方加入...</span>
           </div>
        </div>
      ) : (
        <div className="space-y-6">
           {!peerId ? (
             <div className="flex flex-col items-center justify-center py-12 space-y-4 text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-900/50 rounded-[30px] border border-dashed border-slate-300 dark:border-slate-700/50">
               <Loader2 className="w-10 h-10 animate-spin text-emerald-500" />
               <p className="animate-pulse font-medium">正在初始化安全连接...</p>
               <p className="text-xs text-slate-400 dark:text-slate-500">正在连接信令服务器 (Bilibili/Xiaomi/Google)...</p>
             </div>
           ) : (
             <>
                <div className="flex flex-col gap-4 w-full">
                    {/* Scanner Button Above */}
                    <button 
                        onClick={() => setIsScanning(true)} 
                        className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-300 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 py-4 h-16 rounded-full flex items-center justify-center gap-3 transition-all shadow-inner group"
                    >
                        <ScanLine size={22} className="group-hover:scale-110 transition-transform"/>
                        <span className="font-mono text-base md:text-lg font-bold">扫描二维码连接</span>
                    </button>

                    {/* Input Field Below - Matched Height h-16 (4rem) */}
                    <div className="relative w-full">
                      <div className="absolute inset-y-0 left-6 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                        <Lock size={20} />
                      </div>
                      <input 
                        type="text" 
                        value={targetPeerId}
                        onChange={(e) => {
                            setTargetPeerId(e.target.value);
                            if(errorMsg) setErrorMsg(''); 
                        }}
                        placeholder="或者输入房间口令"
                        className={`w-full h-16 bg-slate-50 dark:bg-slate-950/50 border ${errorMsg ? 'border-red-500/50 focus:border-red-500' : 'border-slate-300 dark:border-slate-700 focus:border-emerald-500'} text-slate-900 dark:text-white pl-14 pr-6 rounded-full focus:ring-1 focus:ring-emerald-500/50 outline-none font-mono text-base md:text-lg transition-all shadow-inner placeholder:text-slate-400 dark:placeholder:text-slate-600`}
                      />
                    </div>
                </div>
                
                {errorMsg && (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-[20px] p-4 flex items-start gap-3 animate-in fade-in slide-in-from-top-2">
                        <AlertTriangle className="w-5 h-5 text-red-500 dark:text-red-400 shrink-0 mt-0.5" />
                        <div className="text-red-600 dark:text-red-200 text-sm">
                            <p className="font-bold text-red-700 dark:text-red-100 mb-1">连接受阻</p>
                            {errorMsg}
                            <div className="mt-3 flex gap-4">
                                <button onClick={() => setShowLogs(true)} className="text-slate-900 dark:text-white underline decoration-red-400/50 underline-offset-2 text-xs hover:decoration-red-400">查看日志</button>
                                <button onClick={reconnectPeer} className="text-slate-900 dark:text-white underline decoration-red-400/50 underline-offset-2 text-xs hover:decoration-red-400">重置网络</button>
                            </div>
                        </div>
                    </div>
                )}

                <Button 
                  onClick={() => connectToTarget()} 
                  variant="primary" 
                  isLoading={isConnecting}
                  className="w-full !bg-emerald-600 hover:!bg-emerald-500 shadow-lg shadow-emerald-500/25 !py-3.5 md:!py-4 !text-base md:!text-lg !rounded-full"
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
        <div className="mt-6 bg-slate-900/95 dark:bg-black/80 backdrop-blur-md p-4 rounded-3xl border border-slate-700 dark:border-slate-800 text-[10px] font-mono text-green-400/90 h-40 overflow-y-auto shadow-inner custom-scrollbar">
            <div className="flex justify-between sticky top-0 bg-transparent pb-2 mb-2 border-b border-white/10">
                <span className="font-bold text-slate-300 flex items-center gap-2"><Activity size={12}/> 系统日志</span>
                <span className="cursor-pointer text-slate-500 hover:text-white transition-colors" onClick={() => setLogs([])}>清空</span>
            </div>
            {logs.length === 0 ? <span className="opacity-30 italic">等待系统事件...</span> : logs.map((l, i) => <div key={i} className="mb-1 border-b border-white/5 pb-1 last:border-0">{l}</div>)}
        </div>
      )}

      {/* QR SCANNER FULLSCREEN OVERLAY */}
      {isScanning && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center animate-in fade-in duration-300">
            <style>{`
              @keyframes scanner-line {
                0% { transform: translateY(0); opacity: 0; }
                10% { opacity: 1; }
                90% { opacity: 1; }
                100% { transform: translateY(16rem); opacity: 0; }
              }
              #reader button { display: none; }
              #reader video { 
                 width: 100% !important; 
                 height: 100% !important; 
                 object-fit: cover !important; 
              }
            `}</style>
            
            <div id="reader" className="w-full h-full flex items-center justify-center bg-black"></div>

            <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
               <div className="w-64 h-64 md:w-72 md:h-72 border-2 border-white/20 rounded-[40px] shadow-[0_0_0_9999px_rgba(0,0,0,0.85)] relative">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-[30px] -mt-0.5 -ml-0.5"></div>
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-[30px] -mt-0.5 -mr-0.5"></div>
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-[30px] -mb-0.5 -ml-0.5"></div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-[30px] -mb-0.5 -mr-0.5"></div>
                  
                  <div className="absolute top-0 left-0 w-full h-12 bg-gradient-to-b from-emerald-500/0 via-emerald-500/20 to-emerald-500/0 animate-[scanner-line_2s_linear_infinite] border-b-2 border-emerald-400/50 drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
               </div>
            </div>

            <div className="absolute top-0 left-0 w-full p-6 pt-14 md:pt-6 z-20 flex justify-between items-start">
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
        </div>
      )}

      {/* RENDER CHAT / ERROR / HOME */}
      {appState === AppState.CHAT && renderChat()}
      {appState === AppState.ERROR && (
        <div className="glass-panel p-10 rounded-[40px] max-w-md w-full text-center border border-red-500/30 shadow-[0_0_50px_rgba(239,68,68,0.2)] bg-white/80 dark:bg-slate-900/80">
            <div className="w-24 h-24 bg-red-100 dark:bg-red-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-red-500/20">
                <AlertTriangle className="w-12 h-12 text-red-500" />
            </div>
            <h3 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">连接中断</h3>
            <p className="text-slate-500 dark:text-slate-400 mb-8 leading-relaxed text-sm">{errorMsg}</p>
            <Button variant="secondary" onClick={() => window.location.reload()} className="w-full">重新加载</Button>
        </div>
      )}
    </div>
  );

  const renderChat = () => (
    <div className="w-full h-[100dvh] md:h-[85vh] md:max-w-3xl flex flex-col glass-panel md:rounded-[40px] rounded-none overflow-hidden shadow-2xl md:shadow-black/50 animate-in fade-in zoom-in-95 duration-500 md:border border-slate-200 dark:border-white/10 bg-slate-50 md:bg-white/50 dark:bg-[#020617] md:dark:bg-transparent">
      {/* CHAT HEADER */}
      <div className="p-4 md:p-5 bg-white/90 dark:bg-slate-900/80 border-b border-slate-200 dark:border-white/5 flex justify-between items-center backdrop-blur-xl relative z-20 pt-safe-top transition-colors">
         <div className="flex items-center gap-3 md:gap-4">
             <div className={`w-10 h-10 md:w-12 md:h-12 rounded-[20px] flex items-center justify-center text-white font-bold shadow-lg ${role === 'sender' ? 'bg-gradient-to-br from-indigo-500 to-violet-600 shadow-indigo-500/20' : 'bg-gradient-to-br from-emerald-500 to-teal-600 shadow-emerald-500/20'}`}>
                 {role === 'sender' ? <Wifi size={20} className="md:w-6 md:h-6" /> : <Download size={20} className="md:w-6 md:h-6" />}
             </div>
             <div>
                 <h3 className="font-bold text-slate-800 dark:text-white text-base md:text-lg tracking-tight">加密传输通道</h3>
                 <div className="flex items-center gap-2 mt-0.5">
                     {connectionStatus === 'Connected' ? (
                        <>
                           <span className={`relative flex h-2 w-2 md:h-2.5 md:w-2.5`}>
                             <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                             <span className="relative inline-flex rounded-full h-2 w-2 md:h-2.5 md:w-2.5 bg-emerald-500"></span>
                           </span>
                           <span className="text-[10px] md:text-xs text-emerald-600 dark:text-emerald-400 font-medium tracking-wide uppercase">Direct P2P Link</span>
                        </>
                     ) : (
                        <>
                           <span className="relative inline-flex rounded-full h-2 w-2 md:h-2.5 md:w-2.5 bg-red-500"></span>
                           <span className="text-[10px] md:text-xs text-red-500 dark:text-red-400 font-medium tracking-wide uppercase flex items-center gap-1">
                             Connection Lost 
                             <button onClick={() => connectToTarget(undefined, true)} className="underline hover:text-red-300 ml-1">重连</button>
                           </span>
                        </>
                     )}
                 </div>
             </div>
         </div>
         <div className="flex gap-2">
             <button onClick={toggleFullScreen} className="md:hidden p-2 hover:bg-slate-200 dark:hover:bg-white/5 rounded-full text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-all border border-transparent" title={isFullscreen ? "退出全屏" : "全屏"}>
                 {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
             </button>
             <button onClick={resetToHome} className="p-2 md:p-3 hover:bg-slate-200 dark:hover:bg-white/5 rounded-full text-slate-500 dark:text-slate-400 hover:text-red-500 dark:hover:text-red-400 transition-all border border-transparent" title="断开连接">
                 <X size={20} />
             </button>
         </div>
      </div>

      {/* CHAT MESSAGES AREA */}
      <div className="flex-1 overflow-y-auto p-4 md:p-6 scroll-smooth bg-transparent relative">
          <div className="absolute inset-0 opacity-5 dark:opacity-5 pointer-events-none" style={{backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)', backgroundSize: '30px 30px'}}></div>

          {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full opacity-50 animate-in fade-in duration-1000">
                  <div className="w-20 h-20 md:w-24 md:h-24 bg-slate-200 dark:bg-slate-800/50 rounded-full flex items-center justify-center mb-6 border border-slate-300 dark:border-white/5">
                    <ShieldCheck className="w-10 h-10 md:w-12 md:h-12 text-slate-400 dark:text-slate-500" />
                  </div>
                  <p className="text-slate-500 dark:text-slate-300 font-medium text-lg">通道已建立</p>
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-2 max-w-xs text-center">所有数据通过 WebRTC P2P 协议端到端加密传输，不经过第三方服务器。</p>
              </div>
          )}
          
          <div className="space-y-1">
          {messages.map((msg, index) => {
              const isMe = msg.sender === 'me';
              const isSequence = index > 0 && messages[index - 1].sender === msg.sender;
              const isError = msg.status === 'error';
              
              return (
                  <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'} ${isSequence ? 'mt-1' : 'mt-6'} animate-in slide-in-from-bottom-2 duration-300 group`}>
                      
                      {!isMe && (
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mr-2 md:mr-3 border border-slate-200 dark:border-white/10 shadow-sm transition-opacity ${isSequence ? 'opacity-0' : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400'}`}>
                           {!isSequence && <User size={14} />}
                        </div>
                      )}

                      <div className={`max-w-[85%] sm:max-w-[70%] shadow-md relative transition-all hover:shadow-lg ${
                          isError 
                            ? 'bg-red-100 dark:bg-red-500/10 border-red-200 dark:border-red-500/50 text-red-800 dark:text-red-100' 
                            : isMe 
                              ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white border border-indigo-400/20' 
                              : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700/50'
                      } ${
                          isMe 
                            ? (isSequence ? 'rounded-[24px] rounded-tr-md' : 'rounded-[24px] rounded-tr-sm') 
                            : (isSequence ? 'rounded-[24px] rounded-tl-md' : 'rounded-[24px] rounded-tl-sm')
                      }`}>
                          <div className={`${msg.type === 'file' ? 'p-2' : 'px-4 py-3 md:px-5 md:py-3.5'}`}>
                              {msg.type === 'text' && <p className="break-words leading-relaxed whitespace-pre-wrap text-[15px]">{msg.content}</p>}

                              {msg.type === 'file' && (
                                  <div className={`w-full sm:w-72 rounded-[20px] p-3 ${isError ? 'bg-red-5 dark:bg-red-900/20' : isMe ? 'bg-indigo-800/30' : 'bg-slate-100 dark:bg-slate-900/50'} border ${isError ? 'border-red-200 dark:border-red-500/30' : isMe ? 'border-indigo-400/20' : 'border-slate-200 dark:border-white/5'}`}>
                                      <div className="flex items-center gap-3 mb-3">
                                          <div className={`p-2.5 rounded-2xl shrink-0 ${isError ? 'bg-red-200 dark:bg-red-500/20 text-red-600 dark:text-red-400' : isMe ? 'bg-indigo-500/20 text-white' : 'bg-emerald-100 dark:bg-slate-700 text-emerald-600 dark:text-emerald-400'}`}>
                                              {isError ? <AlertTriangle size={20}/> : <FileIcon size={20} />}
                                          </div>
                                          <div className="overflow-hidden min-w-0 flex-1">
                                              <p className="font-bold truncate text-sm mb-0.5" title={msg.fileMeta?.name}>{msg.fileMeta?.name}</p>
                                              <p className="text-[10px] opacity-70 font-mono">
                                                  {((msg.fileMeta?.size || 0) / (1024 * 1024)).toFixed(2)} MB
                                              </p>
                                          </div>
                                      </div>
                                      
                                      {msg.status === 'completed' ? (
                                          isMe ? (
                                            <div className="text-xs flex items-center justify-center gap-1.5 opacity-90 font-medium bg-black/20 py-2 rounded-xl w-full border border-white/5 text-white">
                                                <CheckCheck size={14} /> 传输成功
                                            </div>
                                          ) : (
                                            <a href={msg.fileUrl} download={msg.fileMeta?.name} className="block w-full">
                                                <button className="w-full bg-emerald-500 hover:bg-emerald-400 text-white py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 hover:scale-[1.02] border-t border-white/10">
                                                    <Download size={14} /> 下载
                                                </button>
                                            </a>
                                          )
                                      ) : msg.status === 'error' ? (
                                          <div className="text-xs flex items-center justify-center gap-1.5 opacity-90 font-bold text-red-600 dark:text-red-300 bg-red-100 dark:bg-red-500/10 py-2 rounded-xl w-full border border-red-200 dark:border-red-500/20">
                                              <X size={14} /> 传输失败
                                          </div>
                                      ) : (
                                          <div className="space-y-1.5">
                                              <div className="flex justify-between text-[10px] font-bold tracking-wide uppercase opacity-70">
                                                  <span>{msg.sender === 'me' ? 'Uploading...' : 'Downloading...'}</span>
                                                  <span>{msg.progress}%</span>
                                              </div>
                                              <ProgressBar progress={msg.progress || 0} heightClass="h-1.5" colorClass={isError ? "bg-red-500" : isMe ? "bg-white" : "bg-emerald-400"} />
                                          </div>
                                      )}
                                  </div>
                              )}
                          </div>

                          <div className={`text-[10px] flex items-center gap-1 absolute -bottom-5 ${isMe ? 'right-0' : 'left-0'} font-medium text-slate-400 dark:text-slate-500 transition-opacity ${isSequence ? 'opacity-0 group-hover:opacity-100' : 'opacity-60'}`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              {isMe && <CheckCheck size={14} className={msg.status === 'completed' || msg.type === 'text' ? "text-indigo-400" : msg.status === 'error' ? "text-red-500" : "text-slate-400 dark:text-slate-600"} />}
                          </div>
                      </div>
                  </div>
              )
          })}
          </div>
          <div ref={messagesEndRef} />
      </div>

      {/* INPUT AREA */}
      <div className="p-3 md:p-5 pb-4 md:pb-5 bg-white/95 dark:bg-slate-900/90 border-t border-slate-200 dark:border-white/5 backdrop-blur-xl z-20 safe-area-bottom transition-colors">
          {isTransferring && (
            <div className="mb-3 animate-in slide-in-from-bottom-2">
                <div className="flex items-center justify-between px-4 py-2 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-bold">
                    <span className="flex items-center gap-2"><Smartphone size={14}/> 传输中请保持屏幕常亮</span>
                    <span className="animate-pulse">不要切换应用</span>
                </div>
            </div>
          )}
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
                  className={`p-3 md:p-3.5 rounded-full transition-all shrink-0 shadow-lg ${isTransferring ? 'opacity-30 cursor-not-allowed bg-slate-100 dark:bg-slate-800' : 'hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 hover:text-indigo-500 dark:hover:text-indigo-400 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-indigo-500/50'}`}
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
                      className="w-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 rounded-[28px] py-3 pl-5 pr-10 md:py-3.5 md:pl-6 md:pr-12 focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 outline-none resize-none min-h-[48px] md:min-h-[52px] text-base shadow-inner transition-all"
                      rows={1}
                      style={{ height: 'auto', minHeight: '48px' }}
                  />
                  {inputText && (
                    <div className="hidden md:block absolute right-4 bottom-3.5 text-xs text-slate-400 font-mono">Enter</div>
                  )}
              </div>
              
              <button 
                  onClick={sendMessage}
                  disabled={!inputText.trim() || isTransferring}
                  className={`p-3 md:p-3.5 rounded-full transition-all shrink-0 shadow-lg flex items-center justify-center ${
                      !inputText.trim() || isTransferring 
                      ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed border border-slate-200 dark:border-slate-700' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-500/30 hover:scale-105 active:scale-95 border-t border-white/10'
                  }`}
              >
                  {isTransferring ? <Loader2 size={20} className="animate-spin md:w-[22px] md:h-[22px]" /> : <ArrowUpCircle size={22} className="md:w-[24px] md:h-[24px]" />}
              </button>
          </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center relative overflow-hidden font-sans selection:bg-indigo-500/30 transition-colors duration-500">
       
       <div className="fixed inset-0 tech-grid z-0 opacity-40"></div>
       
       {appState !== AppState.CHAT && (
           <div className="absolute top-6 right-6 md:top-8 md:right-8 z-50 animate-in fade-in duration-700">
               <button 
                   onClick={toggleTheme}
                   className="p-3 rounded-full bg-white/10 dark:bg-slate-800/50 backdrop-blur-md border border-slate-200 dark:border-white/10 text-slate-600 dark:text-slate-300 hover:bg-white/20 dark:hover:bg-slate-700/50 transition-all shadow-lg hover:scale-110"
                   title={theme === 'dark' ? "Switch to Light Mode" : "Switch to Dark Mode"}
               >
                   {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
               </button>
           </div>
       )}

       {appState === AppState.SETUP && (
         <div className="absolute top-4 left-4 md:top-6 md:left-6 z-50 flex gap-3 items-center animate-in fade-in duration-300">
            {serverStatus === 'connecting' && <div className="bg-slate-900/80 border border-yellow-500/30 text-yellow-400 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md shadow-lg animate-pulse"><Loader2 size={12} className="animate-spin"/> 连接服务器...</div>}
            {serverStatus === 'disconnected' && (
                <button onClick={reconnectPeer} className="bg-red-500/10 border border-red-500/50 text-red-400 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md shadow-lg hover:bg-red-500/20 transition-all cursor-pointer group">
                    <RefreshCw size={12} className="group-hover:rotate-180 transition-transform"/> 服务器离线
                </button>
            )}
            {serverStatus === 'connected' && (
                 <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold px-3 py-1.5 rounded-full flex items-center gap-2 backdrop-blur-md shadow-lg">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    在线
                 </div>
            )}
         </div>
       )}

       {showHelp && (
           <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300" onClick={() => setShowHelp(false)}>
               <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 p-6 md:p-8 rounded-[40px] max-w-md w-full shadow-2xl relative overflow-hidden" onClick={e => e.stopPropagation()}>
                   <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-500"></div>
                   <div className="flex justify-between items-center mb-6">
                       <h3 className="text-xl font-bold flex items-center gap-2 text-slate-900 dark:text-white"><Sparkles className="text-yellow-500 dark:text-yellow-400" size={20}/> 核心技术原理</h3>
                       <button onClick={() => setShowHelp(false)} className="text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors bg-slate-100 dark:bg-white/5 p-2 rounded-full"><X size={20}/></button>
                   </div>
                   <div className="space-y-5 text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
                       <p>NexusDrop 使用前沿的 <span className="text-indigo-600 dark:text-indigo-400 font-bold">WebRTC</span> 技术实现浏览器间的直接通信。</p>
                       
                       <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-3xl border border-slate-200 dark:border-white/5">
                           <div className="flex items-center gap-3 mb-2">
                               <Server size={18} className="text-indigo-500 dark:text-indigo-400"/>
                               <strong className="text-slate-900 dark:text-white">1. 信令握手</strong>
                           </div>
                           <p className="text-xs text-slate-500 dark:text-slate-400 pl-8">设备A和设备B通过服务器交换“网络名片”（SDP信息）。这就像两个人互换电话号码。</p>
                       </div>

                       <div className="bg-slate-50 dark:bg-slate-950 p-4 rounded-3xl border border-slate-200 dark:border-white/5">
                           <div className="flex items-center gap-3 mb-2">
                               <ShieldCheck size={18} className="text-emerald-500 dark:text-emerald-400"/>
                               <strong className="text-slate-900 dark:text-white">2. P2P 直连</strong>
                           </div>
                           <p className="text-xs text-slate-500 dark:text-slate-400 pl-8">一旦“电话”打通，服务器立即断开。您的文件直接从设备A飞到设备B，<span className="text-emerald-600 dark:text-emerald-400">不经过任何云端存储</span>。</p>
                       </div>
                   </div>
                   <button onClick={() => setShowHelp(false)} className="w-full mt-8 py-3 bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 rounded-full font-bold transition-opacity">明白，开始传输</button>
               </div>
           </div>
       )}

      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[-10%] w-[800px] h-[800px] bg-indigo-500/10 rounded-full blur-[120px] animate-float opacity-40"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-emerald-500/10 dark:bg-emerald-600/5 rounded-full blur-[120px] animate-float opacity-30" style={{animationDelay: '-3s'}}></div>
      </div>

      <header className={`w-full text-center z-10 transition-all duration-700 ease-out ${appState === AppState.CHAT ? 'hidden md:flex py-6' : 'flex py-8 md:py-24'} ${appState === AppState.SETUP ? 'py-6' : ''}`}>
        {appState === AppState.HOME ? (
            <div className="animate-in fade-in slide-in-from-top-8 duration-1000 px-4 flex items-center justify-center gap-4">
                <NexusLogo size={64} className="animate-float" />
                <h1 className="text-5xl md:text-8xl font-black text-transparent bg-clip-text bg-gradient-to-b from-slate-900 via-slate-800 to-slate-500 dark:from-white dark:via-white dark:to-slate-500 mb-0 tracking-tighter drop-shadow-2xl dark:drop-shadow-[0_0_30px_rgba(255,255,255,0.2)]">
                    Nexus<span className="text-indigo-600 dark:text-indigo-500 inline-block hover:scale-105 transition-transform cursor-default">Drop</span>
                </h1>
            </div>
        ) : (
            <div onClick={resetToHome} className="cursor-pointer group inline-flex items-center gap-3">
                <NexusLogo size={32} />
                <h1 className="text-2xl font-black text-slate-900 dark:text-white tracking-tight group-hover:text-indigo-500 dark:group-hover:text-indigo-300 transition-colors drop-shadow-lg">
                    Nexus<span className="text-indigo-600 dark:text-indigo-500">Drop</span>
                </h1>
            </div>
        )}
      </header>

      <main className={`flex-1 flex flex-col items-center w-full z-10 ${appState === AppState.CHAT ? 'justify-end md:justify-center p-0 md:px-4 md:pb-12' : 'justify-center px-4 pb-12'}`}>
        {appState === AppState.HOME && renderHome()}
        {appState === AppState.SETUP && renderSetup()}
        {appState === AppState.CHAT && renderChat()}
      </main>
    </div>
  );
};

export default App;