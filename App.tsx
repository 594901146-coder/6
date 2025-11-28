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
    
    {/* 
       Minimalist Nexus Drop 
       - Removed the background squircle box for a cleaner, integrated look.
       - A solid gradient teardrop representing "Drop".
       - A negative space circle in the center representing "Core/Node".
    */}
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
    // Only auto-trigger on mobile devices to improve immersion
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

  // Monitor visibility changes (Backgrounding)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (isTransferring) {
           addLog("⚠️ 警告: 浏览器已切换至后台，传输可能会中断！");
        }
      } else {
        // Returned to foreground
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

  // Prevent closing tab while transferring
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isTransferring) {
        e.preventDefault();
        e.returnValue = ''; // Standard for Chrome
        return '当前正在传输文件，确定要退出吗？';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isTransferring]);

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
      // Delay slightly to ensure DOM is ready
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
            
            // Rebuilt Configuration for Maximum Accuracy on Mobile
            // 1. Calculate the aspect ratio of the screen to minimize black bars
            const aspectRatio = window.innerWidth / window.innerHeight;

            const config = { 
              fps: 15, // Increased FPS for smoother preview
              qrbox: { width: 250, height: 250 }, 
              aspectRatio: aspectRatio, // Pass screen aspect ratio
              disableFlip: false,
              videoConstraints: {
                  facingMode: "environment",
                  // Requesting HD resolution is critical for good detection
                  // We also try to match the screen's aspect ratio in the request
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
              (errorMessage: string) => {
                  // Ignore parse errors, they happen every frame no QR is found
              } 
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
    
    // Safety check for library loading
    if (typeof window.Peer === 'undefined') {
      const msg = "PeerJS 组件尚未加载完成，请检查网络连接 (CDN)";
      setErrorMsg(msg);
      addLog("CRITICAL ERROR: window.Peer is undefined");
      setShowLogs(true); // Auto-show logs on critical error
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
             { urls: 'stun:stun.chat.bilibili.com:3478' }, // Bilibili (China Strong)
             { urls: 'stun:stun.miwifi.com' },             // Xiaomi (China Strong)
             { urls: 'stun:stun.qq.com:3478' },            // Tencent (China Strong)
             { urls: 'stun:stun.l.google.com:19302' }      // Google (Global)
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
        // Note: We DO NOT destroy the peer here. P2P connections might still be alive.
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
        setShowLogs(true); // Auto-show logs on error
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
              attemptAutoFullScreen(); // Trigger Fullscreen on connection success
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
          lastProgressUpdateRef.current = 0;
          
          setIsTransferring(true);
          requestWakeLock(); // Request Wake Lock on Receive

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

        // Throttle UI updates to max 10fps (every 100ms) to keep main thread free for data processing
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
            releaseWakeLock(); // Release Wake Lock when done
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
      for (let i = 0; i < 20; i++) { // Wait up to 2 seconds
          await new Promise(r => setTimeout(r, 100));
          if (typeof window.Peer !== 'undefined') {
              addLog("PeerJS 加载完成");
              return true;
          }
      }
      return false;
  };

  // RESET FUNCTION - REPLACES RELOAD
  const resetToHome = useCallback(() => {
     addLog("正在断开连接并返回首页...");
     
     // 1. Close Data Connection
     if(connRef.current) {
         connRef.current.close();
         connRef.current = null;
     }
     
     // 2. Destroy Peer
     if(peerRef.current) {
         peerRef.current.destroy();
         peerRef.current = null;
     }
     
     // 3. Stop Scanner
     if(scannerRef.current) {
         scannerRef.current.stop().catch(() => {});
         scannerRef.current = null;
     }
     
     // 4. Clear Timers
     stopHeartbeat();
     releaseWakeLock();
     if(connectionTimeoutRef.current) clearTimeout(connectionTimeoutRef.current);
     
     // 5. Reset State
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
     setShowTextCode(false); // Reset to QR view
     setIsScanning(false);
     // Note: we keep logs for debug, but you could setLogs([]) if preferred
  }, []);

  const startRoom = async () => {
    attemptAutoFullScreen();
    setAppState(AppState.SETUP); // Switch UI immediately
    setRole('sender');
    setIsGeneratingId(true);
    setShowTextCode(false); // Default to QR view
    setErrorMsg('');
    setLogs([]); // Start fresh logs
    
    // Ensure cleanup of any previous session
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
    setLogs([]); // Start fresh logs
    addLog("初始化接收端...");
    
    // Ensure cleanup of any previous session
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }
    
    const ready = await waitForPeerJS();
    if (!ready) {
        setErrorMsg("核心组件加载超时，请刷新页面");
        return;
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
    if (!inputText.trim()) return;
    
    // Robust checking for P2P connection even if signaling is down
    if (!connRef.current) {
        alert("错误：P2P 连接对象不存在");
        return;
    }
    
    if (!connRef.current.open) {
        addLog("尝试发送消息，但连接状态未 OPEN");
        alert("连接似乎已断开，无法发送消息");
        // Don't return, try anyway just in case UI is stale
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
        requestWakeLock(); // Lock screen on send start
        e.target.value = '';
    }
  };

  // High Performance File Streamer
  const streamFile = async (file: File) => {
      // Chunk size optimized for throughput (64KB)
      const chunkSize = 64 * 1024; 
      let offset = 0;
      let lastUpdate = 0;
      
      try {
          // Use a loop instead of recursion to avoid stack depth and reduce overhead
          while (offset < file.size) {
              if (!connRef.current || !connRef.current.open) {
                  throw new Error("传输中断：连接已关闭");
              }

              // Backpressure Control:
              // If the WebRTC buffer is full (>16MB), wait for it to drain.
              // This prevents browser crashes while still allowing high speed.
              const channel = connRef.current.dataChannel;
              if (channel && channel.bufferedAmount > 16 * 1024 * 1024) {
                  // Wait 50ms and try again
                  await new Promise(r => setTimeout(r, 50));
                  continue;
              }

              // Read chunk as ArrayBuffer
              // Using await file.slice().arrayBuffer() is cleaner and usually faster than FileReader
              const slice = file.slice(offset, offset + chunkSize);
              const buffer = await slice.arrayBuffer();
              
              connRef.current.send(buffer);
              offset += chunkSize;

              // Throttled UI Updates
              const now = Date.now();
              // Update only every 100ms OR when finished to keep UI responsive
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
              
              // Yield to main thread briefly (0ms) to allow UI updates and events to fire
              // This is critical for keeping the browser responsive during heavy transfers
              await new Promise(r => setTimeout(r, 0));
          }

          // Complete
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
          
          // Explicitly mark message as Error so the UI turns red
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

  // --- RENDERERS ---

  const renderHome = () => (
    <div className="flex flex-col md:flex-row gap-6 md:gap-8 max-w-5xl w-full animate-in fade-in slide-in-from-bottom-8 duration-700 items-center justify-center">
      <div 
        onClick={() => { startRoom(); }}
        className="group cursor-pointer relative w-full md:w-[420px]"
      >
        <div className="absolute inset-0 bg-indigo-500/20 blur-[60px] opacity-0 group-hover:opacity-100 transition-opacity duration-700 rounded-full"></div>
        <div className="glass-panel w-full md:min-h-[360px] rounded-[30px] md:rounded-[40px] p-6 md:p-8 flex flex-col items-center justify-center md:justify-start text-center border border-slate-200 dark:border-white/5 bg-gradient-to-br from-white/80 to-slate-100/80 dark:from-slate-900/80 dark:to-slate-950/80 hover:border-indigo-500/50 shadow-2xl transition-all duration-300 hover:-translate-y-2 group-hover:shadow-[0_0_40px_rgba(99,102,241,0.2)]">
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
        <div className="glass-panel w-full md:min-h-[360px] rounded-[30px] md:rounded-[40px] p-6 md:p-8 flex flex-col items-center justify-center md:justify-start text-center border border-slate-200 dark:border-white/5 bg-gradient-to-br from-white/80 to-slate-100/80 dark:from-slate-900/80 dark:to-slate-950/80 hover:border-emerald-500/50 shadow-2xl transition-all duration-300 hover:-translate-y-2 group-hover:shadow-[0_0_40px_rgba(16,185,129,0.2)]">
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
      {/* Consolidated Header with Toolbar */}
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

        {/* Toolbar Group */}
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
           {/* Rounded-2xl -> Rounded-[30px] */}
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
                    // --- QR MODE (DEFAULT) ---
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
                    // --- TEXT MODE ---
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
           {/* Connection readiness check */}
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
                        className="w-full bg-slate-50 dark:bg-slate-950/50 border border-slate-300 dark:border-slate-700 hover:border-emerald-500 dark:hover:border-emerald-500 text-slate-600 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 py-4 rounded-full flex items-center justify-center gap-3 transition-all shadow-inner group"
                    >
                        <ScanLine size={22} className="group-hover:scale-110 transition-transform"/>
                        <span className="font-mono text-base md:text-lg font-bold">扫描二维码连接</span>
                    </button>

                    {/* Input Field Below */}
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
                        className={`w-full bg-slate-50 dark:bg-slate-950/50 border ${errorMsg ? 'border-red-500/50 focus:border-red-500' : 'border-slate-300 dark:border-slate-700 focus:border-emerald-500'} text-slate-900 dark:text-white pl-14 pr-6 py-4 rounded-full focus:ring-1 focus:ring-emerald-500/50 outline-none font-mono text-base md:text-lg transition-all shadow-inner placeholder:text-slate-400 dark:placeholder:text-slate-600`}
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
              /* Hide the default HTML5-QRCode buttons if they appear */
              #reader button { display: none; }
              /* Force video to center and contain within aspect ratio logic */
              #reader video { 
                 width: 100% !important; 
                 height: 100% !important; 
                 object-fit: cover !important; 
              }
            `}</style>
            
            {/* Camera Feed Container */}
            <div id="reader" className="w-full h-full flex items-center justify-center bg-black"></div>

            {/* Dark Overlay Mask */}
            <div className="absolute inset-0 pointer-events-none z-10 flex items-center justify-center">
               <div className="w-64 h-64 md:w-72 md:h-72 border-2 border-white/20 rounded-[40px] shadow-[0_0_0_9999px_rgba(0,0,0,0.85)] relative">
                  {/* Corner Accents */}
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-emerald-500 rounded-tl-[30px] -mt-0.5 -ml-0.5"></div>
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-emerald-500 rounded-tr-[30px] -mt-0.5 -mr-0.5"></div>
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-emerald-500 rounded-bl-[30px] -mb-0.5 -ml-0.5"></div>
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-emerald-500 rounded-br-[30px] -mb-0.5 -mr-0.5"></div>
                  
                  {/* Scanning Laser Line */}
                  <div className="absolute top-0 left-0 w-full h-12 bg-gradient-to-b from-emerald-500/0 via-emerald-500/20 to-emerald-500/0 animate-[scanner-line_2s_linear_infinite] border-b-2 border-emerald-400/50 drop-shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
               </div>
            </div>

            {/* Top Bar */}
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
    </div>
  );
};

export default App;