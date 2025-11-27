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
  MessageSquare
} from 'lucide-react';

// Main Component
const App: React.FC = () => {
  // --- STATE ---
  const [appState, setAppState] = useState<AppState>(AppState.HOME);
  
  // Connection Setup
  const [role, setRole] = useState<'sender' | 'receiver' | null>(null); // 'sender' creates room, 'receiver' joins
  const [peerId, setPeerId] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<string>('Disconnected');
  const [errorMsg, setErrorMsg] = useState<string>('');
  
  // UX State
  const [isGeneratingId, setIsGeneratingId] = useState(false);
  const [isPeerReady, setIsPeerReady] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Chat & Transfer State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  
  // Transfer Control (We assume single file transfer at a time for simplicity in this version)
  const [isTransferring, setIsTransferring] = useState(false);

  // --- REFS ---
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const scannerRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Buffer Refs for Receiving
  const incomingFileIdRef = useRef<string | null>(null);
  const receivedChunksRef = useRef<BlobPart[]>([]);
  const receivedSizeRef = useRef<number>(0);
  const currentIncomingMetaRef = useRef<FileMetadata | null>(null);

  // Helper to scroll chat to bottom
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Check PeerJS Load
  useEffect(() => {
    if (typeof window.Peer === 'undefined') {
      const checkInterval = setInterval(() => {
        if (typeof window.Peer !== 'undefined') {
          setIsPeerReady(true);
          clearInterval(checkInterval);
        } else {
          setIsPeerReady(false);
        }
      }, 1000);
      setTimeout(() => clearInterval(checkInterval), 5000);
      return () => clearInterval(checkInterval);
    }
  }, []);

  // --- SCANNER LOGIC ---
  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      const timer = setTimeout(() => {
        const startScanner = async () => {
          if (typeof window.Html5Qrcode === 'undefined') {
            setErrorMsg("扫码库未加载");
            setIsScanning(false);
            return;
          }
          try {
            const html5QrCode = new window.Html5Qrcode("reader");
            scannerRef.current = html5QrCode;
            const width = window.innerWidth;
            const qrBoxSize = Math.min(width * 0.8, 300);
            await html5QrCode.start(
              { facingMode: "environment" }, 
              { fps: 20, qrbox: { width: qrBoxSize, height: qrBoxSize }, aspectRatio: 1.0 },
              (decodedText: string) => {
                if (decodedText && decodedText.length > 3) {
                  // Vibrate for feedback
                  if (navigator.vibrate) navigator.vibrate(50);
                  
                  // Stop scanner
                  stopScanner();

                  // Auto Connect logic
                  // We pass the decoded text directly to connectToTarget to avoid state update lag
                  connectToTarget(decodedText);
                }
              },
              () => {}
            );
          } catch (err) {
            setErrorMsg("无法启动摄像头");
            setIsScanning(false);
          }
        };
        startScanner();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [isScanning]);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (e) {}
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  // --- PEER INITIALIZATION ---
  const initializePeer = useCallback((id?: string) => {
    if (peerRef.current) return peerRef.current;
    if (typeof window.Peer === 'undefined') {
      setErrorMsg("PeerJS 未加载");
      setAppState(AppState.ERROR);
      return null;
    }

    try {
      // Config with more STUN servers for better connectivity in China
      const peer = new window.Peer(id, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.miwifi.com' }, // Xiaomi
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun.qq.com:3478' }, // Tencent
            { urls: 'stun:stun.voipbuster.com' }
          ]
        }
      });

      peer.on('open', (id: string) => {
        setPeerId(id);
      });

      peer.on('connection', (conn: any) => {
        handleConnection(conn);
      });

      peer.on('error', (err: any) => {
        console.error('Peer error:', err);
        // Only stop connecting spinner if we were actively trying to connect
        setIsConnecting(false); 
        let msg = `连接错误: ${err.type}`;
        if (err.type === 'peer-unavailable') msg = "找不到该房间，请检查口令。";
        else if (err.type === 'network') msg = "网络连接失败，请检查网络设置。";
        else if (err.type === 'server-error') msg = "无法连接到信令服务器。";
        setErrorMsg(msg);
      });

      peerRef.current = peer;
      return peer;
    } catch (e: any) {
      setErrorMsg("初始化失败: " + e.message);
      setAppState(AppState.ERROR);
      return null;
    }
  }, []);

  const handleConnection = (conn: any) => {
    if (connRef.current) {
        connRef.current.close();
    }
    
    connRef.current = conn;
    
    conn.on('open', () => {
      setConnectionStatus('Connected');
      setIsConnecting(false); // Success!
      setErrorMsg('');
      setAppState(AppState.CHAT);
    });

    conn.on('data', (data: any) => {
      handleIncomingData(data);
    });

    conn.on('close', () => {
      setConnectionStatus('Disconnected');
      setIsConnecting(false);
      addSystemMessage("对方已断开连接");
    });
    
    conn.on('error', (err: any) => {
      console.error("Conn error", err);
      setIsConnecting(false);
      setConnectionStatus('Disconnected');
      setErrorMsg("连接中断");
    });
  };

  // --- DATA HANDLING (Protocol) ---

  const handleIncomingData = (data: any) => {
    // 1. Check for Binary (File Chunk)
    const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array || data instanceof Blob || (data && data.buffer instanceof ArrayBuffer);
    
    if (isBinary) {
      handleFileChunk(data);
      return;
    }

    // 2. Check for JSON Commands
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
          currentIncomingMetaRef.current = meta;
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
          
          connRef.current.send({ type: 'ACK_FILE_START' });
          break;
        
        case 'ACK_FILE_START':
           if (pendingFileTransferRef.current) {
             streamFile(pendingFileTransferRef.current);
             pendingFileTransferRef.current = null;
           }
           break;
      }
    }
  };

  const handleFileChunk = (data: any) => {
    if (!currentIncomingMetaRef.current) return;
    
    const chunk = data instanceof Blob ? data : new Blob([data]);
    receivedChunksRef.current.push(chunk);
    receivedSizeRef.current += chunk.size;

    const total = currentIncomingMetaRef.current.size;
    const progress = Math.round((receivedSizeRef.current / total) * 100);

    setMessages(prev => prev.map(m => {
        if (m.id === currentIncomingMetaRef.current?.id) {
            return { ...m, progress: progress };
        }
        return m;
    }));

    if (receivedSizeRef.current >= total) {
        const blob = new Blob(receivedChunksRef.current, { type: currentIncomingMetaRef.current.type });
        const url = URL.createObjectURL(blob);
        
        setMessages(prev => prev.map(m => {
            if (m.id === currentIncomingMetaRef.current?.id) {
                return { ...m, progress: 100, status: 'completed', fileUrl: url };
            }
            return m;
        }));

        currentIncomingMetaRef.current = null;
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
          content: `[系统消息] ${text}`,
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
    try {
      const id = await generateConnectionPhrase();
      initializePeer(id);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setIsGeneratingId(false);
    }
  };

  const joinRoom = () => {
    setRole('receiver');
    setAppState(AppState.SETUP);
    setErrorMsg('');
    initializePeer(); 
  };

  const connectToTarget = (overrideId?: string) => {
    const rawId = typeof overrideId === 'string' ? overrideId : targetPeerId;
    const target = rawId?.trim().toLowerCase(); // Normalize input
    
    if (!peerRef.current) {
        setErrorMsg("网络初始化未完成");
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
    
    // Update state if we used an override ID (from scanner)
    if (overrideId) setTargetPeerId(target);

    setIsConnecting(true);
    setErrorMsg('');
    
    // Explicit 15s Timeout Logic
    setTimeout(() => {
        if (connRef.current && !connRef.current.open) {
           // If connection object exists but isn't open after 15s, it's a timeout
           if (isConnecting) {
             setIsConnecting(false);
             setErrorMsg("连接超时。无法连接到房间，请检查对方是否在线。");
             connRef.current.close();
           }
        }
    }, 15000);

    // Reliable: true is important for file transfer chunks order
    const conn = peerRef.current.connect(target, { reliable: true });
    handleConnection(conn);
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

        connRef.current.send({ type: 'FILE_START', payload: meta });
        
        pendingFileTransferRef.current = file;
        setIsTransferring(true);
        
        e.target.value = '';
    }
  };

  const streamFile = (file: File) => {
      const chunkSize = 64 * 1024; // 64KB
      let offset = 0;
      
      const readSlice = (o: number) => {
          const slice = file.slice(o, o + chunkSize);
          const reader = new FileReader();
          
          reader.onload = (evt) => {
              if (evt.target?.readyState === FileReader.DONE && connRef.current) {
                  connRef.current.send(evt.target.result); 
                  offset += chunkSize;
                  
                  const progress = Math.min((offset / file.size) * 100, 100);
                  setMessages(prev => prev.map(m => {
                      if (m.fileMeta?.name === file.name && m.sender === 'me' && m.status !== 'completed') {
                           return { ...m, progress: progress };
                      }
                      return m;
                  }));

                  if (offset < file.size) {
                      setTimeout(() => readSlice(offset), 0);
                  } else {
                      setIsTransferring(false);
                      setMessages(prev => prev.map(m => {
                        if (m.fileMeta?.name === file.name && m.sender === 'me') {
                             return { ...m, progress: 100, status: 'completed' };
                        }
                        return m;
                      }));
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
    <div className="flex flex-col md:flex-row gap-8 max-w-4xl w-full animate-in fade-in zoom-in duration-500">
      <div 
        onClick={isPeerReady ? startRoom : undefined}
        className={`flex-1 group hover:scale-[1.02] transition-transform duration-300 ${!isPeerReady ? 'opacity-50' : 'cursor-pointer'}`}
      >
        <div className="glass-panel h-64 md:h-80 rounded-2xl p-8 flex flex-col items-center justify-center border-t-4 border-indigo-500 bg-gradient-to-b from-slate-800 to-slate-900 shadow-2xl shadow-indigo-500/10">
          <div className="w-20 h-20 rounded-full bg-indigo-500/20 flex items-center justify-center mb-6 group-hover:bg-indigo-500/30 transition-colors">
            {isGeneratingId ? <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" /> : <Wifi className="w-10 h-10 text-indigo-400" />}
          </div>
          <h2 className="text-2xl font-bold mb-2">创建房间</h2>
          <p className="text-slate-400 text-center">生成一个安全口令，等待对方连接。</p>
        </div>
      </div>

      <div 
        onClick={isPeerReady ? joinRoom : undefined}
        className={`flex-1 group hover:scale-[1.02] transition-transform duration-300 ${!isPeerReady ? 'opacity-50' : 'cursor-pointer'}`}
      >
        <div className="glass-panel h-64 md:h-80 rounded-2xl p-8 flex flex-col items-center justify-center border-t-4 border-emerald-500 bg-gradient-to-b from-slate-800 to-slate-900 shadow-2xl shadow-emerald-500/10">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6 group-hover:bg-emerald-500/30 transition-colors">
            <Download className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">加入房间</h2>
          <p className="text-slate-400 text-center">输入口令或扫描二维码加入。</p>
        </div>
      </div>
    </div>
  );

  const renderSetup = () => (
    <div className="glass-panel p-8 rounded-2xl max-w-lg w-full animate-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          {role === 'sender' ? <Wifi className="text-indigo-400" /> : <Download className="text-emerald-400" />}
          {role === 'sender' ? '等待连接' : '连接房间'}
        </h2>
        <button onClick={exitChat} className="text-slate-500 hover:text-white transition-colors">
            <X size={24} />
        </button>
      </div>

      {role === 'sender' ? (
        // SENDER SETUP UI
        <div className="space-y-6">
           <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 text-center">
            <p className="text-sm text-slate-400 mb-2 uppercase tracking-wider font-semibold">房间口令</p>
            <div className="flex items-center justify-center gap-3 mb-2">
                <span className="text-3xl font-mono font-bold text-white tracking-tight break-all">{peerId || '生成中...'}</span>
                {peerId && (
                <div className="flex gap-1 shrink-0">
                    <button onClick={() => navigator.clipboard.writeText(peerId)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-400 hover:text-white" title="复制">
                        <Copy size={20} />
                    </button>
                    <button onClick={() => setShowQr(!showQr)} className={`p-2 rounded-lg ${showQr ? 'bg-indigo-600 text-white' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`} title="二维码">
                        <QrCode size={20} />
                    </button>
                </div>
                )}
            </div>
            {showQr && peerId && (
                <div className="mt-4 flex flex-col items-center animate-in fade-in duration-300">
                <div className="bg-white p-2 rounded-xl">
                    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(peerId)}&bgcolor=ffffff`} alt="QR" className="w-32 h-32" />
                </div>
                </div>
            )}
           </div>
           <div className="flex items-center justify-center gap-3 py-4 text-slate-400">
               <Loader2 className="animate-spin text-indigo-500" />
               等待对方加入...
           </div>
        </div>
      ) : (
        // RECEIVER SETUP UI
        <div className="space-y-6">
           {!peerId ? (
             <div className="flex flex-col items-center justify-center py-10 space-y-4 text-slate-400">
               <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
               <p className="animate-pulse">正在初始化网络...</p>
             </div>
           ) : (
             <>
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">房间口令</label>
                  <div className="flex gap-2">
                      <input 
                      type="text" 
                      value={targetPeerId}
                      onChange={(e) => {
                          setTargetPeerId(e.target.value);
                          if(errorMsg) setErrorMsg(''); // Clear error on type
                      }}
                      placeholder="例如：neon-cyber-wolf-123"
                      className={`flex-1 bg-slate-900 border ${errorMsg ? 'border-red-500' : 'border-slate-700'} text-white px-4 py-3 rounded-xl focus:ring-2 focus:ring-emerald-500 outline-none font-mono transition-colors`}
                      />
                      <button onClick={() => setIsScanning(true)} className="px-4 bg-slate-700 hover:bg-slate-600 rounded-xl text-white transition-colors" title="扫码">
                      <ScanLine size={20} />
                      </button>
                  </div>
                  {errorMsg && <p className="text-red-400 text-sm mt-2 flex items-center gap-1"><AlertTriangle size={14} /> {errorMsg}</p>}
                </div>
                <Button 
                  onClick={() => connectToTarget()} 
                  variant="primary" 
                  isLoading={isConnecting}
                  className="w-full !bg-emerald-600 hover:!bg-emerald-500"
                  icon={<ArrowRight size={18} />}
                >
                  {isConnecting ? '正在连接...' : '连接'}
                </Button>
             </>
           )}
        </div>
      )}

      {/* QR SCANNER OVERLAY */}
      {isScanning && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
            <div className="absolute top-0 w-full p-4 flex justify-between z-20">
                <div className="text-white font-bold flex gap-2"><Camera /> 扫描二维码</div>
                <button onClick={stopScanner} className="bg-white/20 p-2 rounded-full text-white"><X /></button>
            </div>
            <div id="reader" className="w-full h-full"></div>
            
            {/* Visual Guide */}
            <div className="absolute pointer-events-none inset-0 flex items-center justify-center z-10">
                <div className="w-64 h-64 border-2 border-emerald-400 rounded-xl relative opacity-50">
                    <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.8)] animate-[scan_2s_linear_infinite]"></div>
                    <style>{`@keyframes scan { 0% { top: 0 } 50% { top: 100% } 100% { top: 0 } }`}</style>
                </div>
            </div>
            <p className="absolute bottom-10 text-white/70 bg-black/50 px-4 py-2 rounded-full backdrop-blur-sm z-20">请将二维码对准框内</p>
        </div>
      )}
    </div>
  );

  const renderChat = () => (
    <div className="w-full max-w-2xl h-[85vh] flex flex-col glass-panel rounded-2xl overflow-hidden shadow-2xl shadow-black/50 animate-in fade-in zoom-in duration-300">
      {/* CHAT HEADER */}
      <div className="p-4 bg-slate-900/80 border-b border-slate-700 flex justify-between items-center backdrop-blur-md">
         <div className="flex items-center gap-3">
             <div className="w-10 h-10 rounded-full bg-indigo-500 flex items-center justify-center text-white font-bold">
                 {role === 'sender' ? <Wifi size={20} /> : <Download size={20} />}
             </div>
             <div>
                 <h3 className="font-bold text-white leading-tight">安全连接</h3>
                 <div className="flex items-center gap-1.5">
                     <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                     <span className="text-xs text-emerald-400">在线 • P2P加密</span>
                 </div>
             </div>
         </div>
         <button onClick={exitChat} className="p-2 hover:bg-slate-800 rounded-full text-slate-400 hover:text-red-400 transition-colors">
             <X size={20} />
         </button>
      </div>

      {/* CHAT MESSAGES AREA */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth">
          {messages.length === 0 && (
              <div className="text-center py-10 opacity-50">
                  <ShieldCheck className="w-12 h-12 mx-auto mb-2 text-slate-500" />
                  <p className="text-slate-400">连接已建立。您可以开始发送消息或文件了。</p>
              </div>
          )}
          
          {messages.map((msg) => {
              const isMe = msg.sender === 'me';
              return (
                  <div key={msg.id} className={`flex w-full ${isMe ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[80%] rounded-2xl p-3 ${
                          isMe 
                          ? 'bg-indigo-600 text-white rounded-br-none' 
                          : 'bg-slate-700 text-slate-100 rounded-bl-none'
                      }`}>
                          {/* Text Content */}
                          {msg.type === 'text' && <p className="break-words leading-relaxed">{msg.content}</p>}

                          {/* File Content */}
                          {msg.type === 'file' && (
                              <div className="w-64">
                                  <div className="flex items-center gap-3 mb-3">
                                      <div className={`p-2 rounded-lg ${isMe ? 'bg-indigo-500' : 'bg-slate-600'}`}>
                                          <FileIcon size={24} />
                                      </div>
                                      <div className="overflow-hidden">
                                          <p className="font-medium truncate text-sm">{msg.fileMeta?.name}</p>
                                          <p className="text-xs opacity-70">
                                              {((msg.fileMeta?.size || 0) / (1024 * 1024)).toFixed(2)} MB
                                          </p>
                                      </div>
                                  </div>
                                  
                                  {/* Progress or Actions */}
                                  {msg.status === 'completed' ? (
                                      isMe ? (
                                        <div className="text-xs flex items-center gap-1 opacity-80"><CheckCircle size={12} /> 已发送</div>
                                      ) : (
                                        <a href={msg.fileUrl} download={msg.fileMeta?.name} className="block w-full">
                                            <button className="w-full bg-white/20 hover:bg-white/30 text-white py-1.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2">
                                                <Download size={14} /> 下载
                                            </button>
                                        </a>
                                      )
                                  ) : (
                                      <div className="space-y-1">
                                          <div className="flex justify-between text-xs opacity-70">
                                              <span>{msg.sender === 'me' ? '发送中...' : '接收中...'}</span>
                                              <span>{msg.progress}%</span>
                                          </div>
                                          <ProgressBar progress={msg.progress || 0} heightClass="h-1.5" colorClass={isMe ? "bg-white/80" : "bg-emerald-500"} />
                                      </div>
                                  )}
                              </div>
                          )}
                          
                          <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                          </div>
                      </div>
                  </div>
              )
          })}
          <div ref={messagesEndRef} />
      </div>

      {/* INPUT AREA */}
      <div className="p-4 bg-slate-900/50 border-t border-slate-700 backdrop-blur-md">
          <div className="flex items-end gap-2 bg-slate-800/80 p-2 rounded-xl border border-slate-700 focus-within:border-indigo-500/50 transition-colors">
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
                  className={`p-2 rounded-lg transition-colors shrink-0 mb-0.5 ${isTransferring ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`}
                  title="发送文件"
              >
                  <Paperclip size={20} />
              </button>
              
              <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  onKeyDown={handleKeyPress}
                  placeholder={isTransferring ? "文件传输中，请稍候..." : "输入消息..."}
                  disabled={isTransferring}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-white placeholder-slate-500 resize-none max-h-32 py-2.5 min-h-[44px]"
                  rows={1}
                  style={{ height: 'auto', minHeight: '44px' }}
              />
              
              <button 
                  onClick={sendMessage}
                  disabled={!inputText.trim() || isTransferring}
                  className={`p-2.5 rounded-lg mb-0.5 transition-all shrink-0 ${
                      !inputText.trim() || isTransferring 
                      ? 'bg-slate-700 text-slate-500 cursor-not-allowed' 
                      : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/30'
                  }`}
              >
                  {isTransferring ? <Loader2 size={18} className="animate-spin" /> : <ArrowUpCircle size={20} />}
              </button>
          </div>
          {isTransferring && <p className="text-center text-xs text-slate-500 mt-2">正在传输文件，文本聊天暂时禁用以保证数据完整性。</p>}
      </div>
    </div>
  );

  const CheckCircle = ({size = 16}) => (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
  );

  return (
    <div className="min-h-screen flex flex-col items-center relative overflow-hidden bg-slate-950 font-sans">
       {/* Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none -z-10">
        <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-indigo-900/20 rounded-full blur-[120px] animate-pulse"></div>
        <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-emerald-900/10 rounded-full blur-[100px]"></div>
      </div>

      {appState === AppState.HOME && (
          <header className="w-full py-12 text-center z-10 animate-in fade-in slide-in-from-top-4 duration-700">
             <div className="inline-flex items-center gap-3 mb-4 bg-slate-900/50 px-5 py-2 rounded-full border border-slate-800 backdrop-blur-sm">
                 <Zap className="text-yellow-400 w-5 h-5" fill="currentColor" />
                 <span className="text-slate-300 font-medium tracking-wide text-sm">P2P 安全直连 • 不限速</span>
             </div>
             <h1 className="text-5xl md:text-7xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-slate-400 mb-6 tracking-tight">
                 Nexus<span className="text-indigo-500">Drop</span>
             </h1>
             <p className="text-lg text-slate-400 max-w-2xl mx-auto px-6">
                 下一代浏览器点对点传输工具。无需登录，无需服务器中转，像聊天一样发送文件。
             </p>
          </header>
      )}

      <main className="flex-1 flex flex-col items-center justify-center w-full px-4 z-10 pb-10">
        {appState === AppState.HOME && renderHome()}
        {appState === AppState.SETUP && renderSetup()}
        {appState === AppState.CHAT && renderChat()}
        {appState === AppState.ERROR && (
            <div className="glass-panel p-8 rounded-2xl max-w-md w-full text-center border-red-500/30">
                <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                <h3 className="text-xl font-bold text-red-400 mb-2">出错了</h3>
                <p className="text-slate-300 mb-6">{errorMsg}</p>
                <Button variant="secondary" onClick={() => window.location.reload()}>重试</Button>
            </div>
        )}
      </main>
    </div>
  );
};

export default App;