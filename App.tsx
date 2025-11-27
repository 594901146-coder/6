import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AppState, FileMetadata, PeerMessage } from './types';
import { generateConnectionPhrase } from './services/geminiService';
import { Button } from './components/Button';
import { ProgressBar } from './components/ProgressBar';
import { 
  Send, 
  Download, 
  Wifi, 
  CheckCircle, 
  XCircle, 
  Loader2, 
  Copy, 
  FileIcon, 
  ArrowRight,
  ShieldCheck,
  Zap,
  AlertTriangle,
  QrCode,
  ScanLine,
  X
} from 'lucide-react';

// Main Component
const App: React.FC = () => {
  // State
  const [appState, setAppState] = useState<AppState>(AppState.HOME);
  const [peerId, setPeerId] = useState<string>('');
  const [targetPeerId, setTargetPeerId] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<string>('Disconnected');
  const [files, setFiles] = useState<File[]>([]);
  const [currentFileMeta, setCurrentFileMeta] = useState<FileMetadata | null>(null);
  const [transferProgress, setTransferProgress] = useState<number>(0);
  const [receivedFileUrl, setReceivedFileUrl] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [isGeneratingId, setIsGeneratingId] = useState(false);
  const [isPeerReady, setIsPeerReady] = useState(true);
  const [showQr, setShowQr] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  // Refs for persistent data access inside callbacks (avoids stale closures)
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const receivedChunksRef = useRef<BlobPart[]>([]);
  const receivedSizeRef = useRef<number>(0);
  const scannerRef = useRef<any>(null);
  
  // Critical Refs for transfer logic
  const fileMetaRef = useRef<FileMetadata | null>(null);
  const filesRef = useRef<File[]>([]);

  // Check if PeerJS is loaded
  useEffect(() => {
    if (typeof window.Peer === 'undefined') {
      console.warn("PeerJS not loaded yet, checking...");
      const checkInterval = setInterval(() => {
        if (typeof window.Peer !== 'undefined') {
          setIsPeerReady(true);
          clearInterval(checkInterval);
        } else {
          setIsPeerReady(false);
        }
      }, 1000);
      
      // Timeout after 5s
      setTimeout(() => clearInterval(checkInterval), 5000);
      
      return () => clearInterval(checkInterval);
    }
  }, []);

  // --- SCANNER LOGIC ---
  useEffect(() => {
    if (isScanning && !scannerRef.current) {
      // Delay slightly to ensure DOM element exists
      const timer = setTimeout(() => {
        const startScanner = async () => {
          if (typeof window.Html5Qrcode === 'undefined') {
            setErrorMsg("扫码库未加载，请检查网络。");
            setIsScanning(false);
            return;
          }

          try {
            const html5QrCode = new window.Html5Qrcode("reader");
            scannerRef.current = html5QrCode;
            
            await html5QrCode.start(
              { facingMode: "environment" }, 
              {
                fps: 10,
                qrbox: { width: 250, height: 250 }
              },
              (decodedText: string) => {
                // Success callback
                console.log(`Code matched = ${decodedText}`);
                setTargetPeerId(decodedText);
                stopScanner();
              },
              (errorMessage: string) => {
                // parse error, ignore it.
              }
            );
          } catch (err) {
            console.error("Error starting scanner", err);
            setErrorMsg("无法启动摄像头，请确保已授予权限。");
            setIsScanning(false);
          }
        };
        startScanner();
      }, 100);
      return () => clearTimeout(timer);
    }

    return () => {
      // Cleanup happens in stopScanner mainly, but safety check here
    };
  }, [isScanning]);

  const stopScanner = async () => {
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        scannerRef.current.clear();
      } catch (e) {
        console.error("Failed to stop scanner", e);
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
  };

  // --- HELPER: Initialize Peer ---
  const initializePeer = useCallback((id?: string) => {
    if (peerRef.current) return peerRef.current;

    if (typeof window.Peer === 'undefined') {
      setErrorMsg("PeerJS 库未能加载，请检查网络或刷新页面。");
      setAppState(AppState.ERROR);
      return null;
    }

    try {
      // Use Google's public STUN servers to improve connection success rate over the internet
      const peer = new window.Peer(id, {
        debug: 1,
        config: {
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
          ]
        }
      });

      peer.on('open', (id: string) => {
        console.log('My peer ID is: ' + id);
        setPeerId(id);
      });

      peer.on('connection', (conn: any) => {
        console.log('Incoming connection from:', conn.peer);
        handleConnection(conn);
      });

      peer.on('error', (err: any) => {
        console.error('Peer error:', err);
        // Friendly error messages
        let msg = `连接错误: ${err.type}`;
        if (err.type === 'peer-unavailable') msg = "找不到该房间，请检查口令是否正确。";
        if (err.type === 'disconnected') msg = "与服务器的连接已断开。";
        if (err.type === 'network') msg = "网络连接不稳定。";
        if (err.type === 'unavailable-id') msg = "ID 生成冲突，请重试。";
        
        setErrorMsg(msg);
        setAppState(AppState.ERROR);
      });

      peerRef.current = peer;
      return peer;
    } catch (e: any) {
      console.error("Peer init failed:", e);
      setErrorMsg("初始化 P2P 连接失败: " + e.message);
      setAppState(AppState.ERROR);
      return null;
    }
  }, []);

  // --- HELPER: Handle Connection (Both sides) ---
  const handleConnection = (conn: any) => {
    connRef.current = conn;
    
    conn.on('open', () => {
      console.log('Connected to:', conn.peer);
      setConnectionStatus('Connected');
      // If we are sender, we might want to auto-navigate or just wait for file pick
      // If we are receiver, we wait for data
    });

    conn.on('data', (data: any) => {
      handleData(data);
    });

    conn.on('close', () => {
      setConnectionStatus('Disconnected');
      // Optional: Reset state or show alert
    });
    
    conn.on('error', (err: any) => {
        console.error("Connection error:", err);
        setConnectionStatus('Disconnected');
    });
  };

  // --- HELPER: Handle Incoming Data ---
  const handleData = (data: any) => {
    // 1. Metadata packet
    if (data && data.type === 'METADATA') {
      const meta = data.payload as FileMetadata;
      setCurrentFileMeta(meta);
      fileMetaRef.current = meta; // Sync ref for immediate access
      
      receivedChunksRef.current = [];
      receivedSizeRef.current = 0;
      setAppState(AppState.TRANSFERRING);
      setTransferProgress(0);
      
      // Auto-ack to start transfer
      if (connRef.current) {
        connRef.current.send({ type: 'ACK' });
      }
    } 
    // 2. Acknowledgement
    else if (data && data.type === 'ACK') {
      startFileTransfer();
    }
    // 3. File Chunk (Binary)
    else {
      // Robust binary check: PeerJS can send ArrayBuffer, Blob, or Uint8Array
      const isBinary = data instanceof ArrayBuffer || data instanceof Uint8Array || data instanceof Blob || (data && data.buffer instanceof ArrayBuffer);
      
      if (isBinary) {
        // Use Ref because closure 'currentFileMeta' might be stale
        if (!fileMetaRef.current) {
           console.warn("Received binary chunk but metadata is missing.");
           return;
        }

        const chunk = data instanceof Blob ? data : new Blob([data]);
        receivedChunksRef.current.push(chunk);
        receivedSizeRef.current += chunk.size;

        // Calculate progress
        const progress = (receivedSizeRef.current / fileMetaRef.current.size) * 100;
        setTransferProgress(progress);

        if (receivedSizeRef.current >= fileMetaRef.current.size) {
          finishReception();
        }
      }
    }
  };

  // --- SENDER ACTIONS ---

  const startAsSender = async () => {
    setIsGeneratingId(true);
    setShowQr(false);
    try {
      const id = await generateConnectionPhrase();
      initializePeer(id);
      setAppState(AppState.SENDER_LOBBY);
    } catch (e: any) {
      console.error(e);
      setErrorMsg(`初始化发送模式失败: ${e.message}`);
      setAppState(AppState.ERROR);
    } finally {
      setIsGeneratingId(false);
    }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const selectedFiles = Array.from(e.target.files);
      setFiles(selectedFiles);
      filesRef.current = selectedFiles; // Keep ref in sync
    }
  };

  const initiateTransfer = () => {
    // Use ref to be safe, though button click usually has fresh state
    if (!connRef.current || filesRef.current.length === 0) return;
    const file = filesRef.current[0];
    
    const meta: FileMetadata = {
      name: file.name,
      size: file.size,
      type: file.type
    };

    // Send metadata first
    connRef.current.send({ type: 'METADATA', payload: meta });
    setAppState(AppState.TRANSFERRING);
  };

  const startFileTransfer = () => {
    // Must use ref here because this function is called from handleData (stale closure)
    const file = filesRef.current[0];
    if (!file) {
      console.error("No file found to transfer");
      return;
    }

    const chunk_size = 64 * 1024; // 64KB chunks
    let offset = 0;

    // Simple chunk reader
    const readSlice = (o: number) => {
      const slice = file.slice(offset, o + chunk_size);
      const reader = new FileReader();
      
      reader.onload = (evt) => {
        if (!evt.target || !connRef.current) return;
        if (evt.target.readyState === FileReader.DONE) {
          connRef.current.send(evt.target.result); // Send ArrayBuffer
          offset += chunk_size;
          
          const progress = Math.min((offset / file.size) * 100, 100);
          setTransferProgress(progress);

          if (offset < file.size) {
            // Keep reading
             // Small timeout to not freeze UI/Stack
            setTimeout(() => readSlice(offset), 0);
          } else {
             setAppState(AppState.COMPLETED);
          }
        }
      };
      
      reader.readAsArrayBuffer(slice);
    };

    readSlice(0);
  };

  // --- RECEIVER ACTIONS ---

  const startAsReceiver = () => {
    // Receiver doesn't need a specific ID, let PeerJS generate one
    initializePeer();
    setAppState(AppState.RECEIVER_LOBBY);
  };

  const connectToPeer = () => {
    if (!peerRef.current || !targetPeerId) return;
    const conn = peerRef.current.connect(targetPeerId);
    handleConnection(conn);
  };

  const finishReception = () => {
    if (!fileMetaRef.current) return;
    const blob = new Blob(receivedChunksRef.current, { type: fileMetaRef.current.type });
    const url = URL.createObjectURL(blob);
    setReceivedFileUrl(url);
    setAppState(AppState.COMPLETED);
  };

  const resetApp = () => {
     // Clean up
     if (peerRef.current) peerRef.current.destroy();
     if (scannerRef.current) stopScanner();
     
     peerRef.current = null;
     connRef.current = null;
     scannerRef.current = null;
     
     // Reset Refs
     fileMetaRef.current = null;
     filesRef.current = [];
     receivedChunksRef.current = [];
     receivedSizeRef.current = 0;

     // Reset State
     setAppState(AppState.HOME);
     setFiles([]);
     setReceivedFileUrl(null);
     setTransferProgress(0);
     setConnectionStatus('Disconnected');
     setTargetPeerId('');
     setErrorMsg('');
     setShowQr(false);
     setIsScanning(false);
     setCurrentFileMeta(null);
  };

  // --- RENDERERS ---

  const renderHome = () => (
    <div className="flex flex-col md:flex-row gap-8 max-w-4xl w-full">
      {!isPeerReady && (
        <div className="absolute top-20 left-1/2 transform -translate-x-1/2 bg-yellow-600/20 border border-yellow-500/50 text-yellow-200 px-4 py-2 rounded-lg flex items-center gap-2">
           <AlertTriangle size={18} />
           <span>正在加载核心组件，请稍候... (如果长时间未加载，请刷新)</span>
        </div>
      )}
      
      <div 
        onClick={isPeerReady ? startAsSender : undefined}
        className={`flex-1 group hover:scale-[1.02] transition-transform duration-300 ${!isPeerReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className="glass-panel h-64 md:h-80 rounded-2xl p-8 flex flex-col items-center justify-center border-t-4 border-indigo-500 bg-gradient-to-b from-slate-800 to-slate-900">
          <div className="w-20 h-20 rounded-full bg-indigo-500/20 flex items-center justify-center mb-6 group-hover:bg-indigo-500/30 transition-colors">
            {isGeneratingId ? <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" /> : <Send className="w-10 h-10 text-indigo-400" />}
          </div>
          <h2 className="text-2xl font-bold mb-2">我要发送</h2>
          <p className="text-slate-400 text-center">创建安全房间，点对点直传文件。</p>
        </div>
      </div>

      <div 
        onClick={isPeerReady ? startAsReceiver : undefined}
        className={`flex-1 group hover:scale-[1.02] transition-transform duration-300 ${!isPeerReady ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <div className="glass-panel h-64 md:h-80 rounded-2xl p-8 flex flex-col items-center justify-center border-t-4 border-emerald-500 bg-gradient-to-b from-slate-800 to-slate-900">
          <div className="w-20 h-20 rounded-full bg-emerald-500/20 flex items-center justify-center mb-6 group-hover:bg-emerald-500/30 transition-colors">
            <Download className="w-10 h-10 text-emerald-400" />
          </div>
          <h2 className="text-2xl font-bold mb-2">我要接收</h2>
          <p className="text-slate-400 text-center">输入口令加入房间，秒速下载。</p>
        </div>
      </div>
    </div>
  );

  const renderSenderLobby = () => (
    <div className="glass-panel p-8 rounded-2xl max-w-lg w-full">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Wifi className="text-indigo-400" /> 您的房间
      </h2>
      
      <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 mb-8 text-center transition-all duration-300">
        <p className="text-sm text-slate-400 mb-2 uppercase tracking-wider font-semibold">分享此口令</p>
        <div className="flex items-center justify-center gap-3 mb-2">
          <span className="text-3xl font-mono font-bold text-white tracking-tight break-all">{peerId || '...'}</span>
          {peerId && (
            <div className="flex gap-1 shrink-0">
              <button 
                onClick={() => navigator.clipboard.writeText(peerId)}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
                title="复制到剪贴板"
              >
                <Copy size={20} />
              </button>
              <button 
                onClick={() => setShowQr(!showQr)}
                className={`p-2 rounded-lg transition-colors ${showQr ? 'bg-indigo-600 text-white' : 'hover:bg-slate-700 text-slate-400 hover:text-white'}`}
                title="显示二维码"
              >
                <QrCode size={20} />
              </button>
            </div>
          )}
        </div>
        
        {/* QR Code Section */}
        {showQr && peerId && (
          <div className="mt-4 flex flex-col items-center animate-in fade-in slide-in-from-top-2 duration-300">
            <div className="bg-white p-3 rounded-xl shadow-lg shadow-black/20">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(peerId)}&bgcolor=ffffff`} 
                alt="Room QR Code" 
                className="w-40 h-40"
                loading="lazy"
              />
            </div>
            <p className="text-xs text-slate-500 mt-2">扫描二维码获取房间口令</p>
          </div>
        )}
      </div>

      <div className="space-y-6">
        <div className={`p-4 rounded-xl border ${connectionStatus === 'Connected' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-800/50 border-slate-700'} flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <div className={`w-3 h-3 rounded-full ${connectionStatus === 'Connected' ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]' : 'bg-slate-500'}`}></div>
            <span className="font-medium text-slate-200">
              {connectionStatus === 'Connected' ? '设备已连接' : '等待连接...'}
            </span>
          </div>
          {connectionStatus === 'Connected' && <ShieldCheck className="text-emerald-500" size={20} />}
        </div>

        <div className="border-2 border-dashed border-slate-700 hover:border-indigo-500/50 rounded-xl p-8 transition-colors text-center relative">
          <input 
            type="file" 
            onChange={onFileSelect} 
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          {files.length > 0 ? (
            <div className="flex flex-col items-center">
              <FileIcon className="w-12 h-12 text-indigo-400 mb-2" />
              <p className="font-medium text-white truncate max-w-full px-4">{files[0].name}</p>
              <p className="text-sm text-slate-400">{(files[0].size / (1024 * 1024)).toFixed(2)} MB</p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <div className="w-12 h-12 bg-slate-800 rounded-full flex items-center justify-center mb-3">
                <FileIcon className="w-6 h-6 text-slate-400" />
              </div>
              <p className="text-slate-300 font-medium">点击选择文件</p>
              <p className="text-slate-500 text-sm">不限格式，不限大小</p>
            </div>
          )}
        </div>

        <Button 
          onClick={initiateTransfer} 
          disabled={connectionStatus !== 'Connected' || files.length === 0}
          className="w-full"
          icon={<Zap size={18} />}
        >
          开始传输
        </Button>
      </div>
    </div>
  );

  const renderReceiverLobby = () => (
    <div className="glass-panel p-8 rounded-2xl max-w-lg w-full relative">
      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
        <Download className="text-emerald-400" /> 加入房间
      </h2>

      <div className="space-y-6">
        <div>
          <label className="block text-sm font-medium text-slate-400 mb-2">输入房间口令</label>
          <div className="flex gap-2">
            <input 
              type="text" 
              value={targetPeerId}
              onChange={(e) => setTargetPeerId(e.target.value)}
              placeholder="例如：cosmic-red-fox-123"
              className="flex-1 bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none font-mono"
            />
            <button 
              onClick={() => setIsScanning(true)}
              className="px-4 bg-slate-700 hover:bg-slate-600 border border-slate-600 rounded-xl text-white transition-colors flex items-center justify-center"
              title="扫码加入"
            >
              <ScanLine size={20} />
            </button>
          </div>
        </div>

        <Button 
          onClick={connectToPeer} 
          variant="primary" 
          className="w-full !bg-emerald-600 hover:!bg-emerald-500 !shadow-emerald-500/20"
          icon={<ArrowRight size={18} />}
        >
          连接
        </Button>
      </div>

      {/* SCANNER MODAL OVERLAY */}
      {isScanning && (
        <div className="absolute inset-0 z-50 bg-slate-900 flex flex-col items-center justify-center rounded-2xl overflow-hidden p-4">
          <div className="w-full flex justify-between items-center mb-4">
            <h3 className="font-bold text-white">扫描二维码</h3>
            <button onClick={stopScanner} className="p-2 bg-slate-800 rounded-full hover:bg-slate-700">
              <X size={20} />
            </button>
          </div>
          <div id="reader" className="w-full h-64 bg-black rounded-lg overflow-hidden relative">
            {/* Library renders here */}
          </div>
          <p className="text-sm text-slate-400 mt-4 text-center">
            请将发送方的二维码置于框内
          </p>
        </div>
      )}
    </div>
  );

  const renderTransferring = () => (
    <div className="glass-panel p-10 rounded-2xl max-w-lg w-full text-center">
      <div className="relative w-24 h-24 mx-auto mb-8">
        <div className="absolute inset-0 rounded-full border-4 border-slate-700"></div>
        <div 
          className="absolute inset-0 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"
          style={{ animationDuration: '1.5s' }}
        ></div>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold">{Math.round(transferProgress)}%</span>
        </div>
      </div>
      
      <h3 className="text-xl font-bold mb-2">传输中...</h3>
      <p className="text-slate-400 mb-8 truncate px-4">{currentFileMeta?.name}</p>
      
      <ProgressBar progress={transferProgress} />
      
      <p className="mt-4 text-sm text-slate-500">
        正在进行点对点直传，请勿关闭此标签页。
      </p>
    </div>
  );

  const renderCompleted = () => (
    <div className="glass-panel p-10 rounded-2xl max-w-lg w-full text-center animate-in fade-in zoom-in duration-300">
      <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
        <CheckCircle className="w-10 h-10 text-emerald-500" />
      </div>
      
      <h2 className="text-2xl font-bold mb-2">传输完成！</h2>
      <p className="text-slate-400 mb-8 truncate px-4">{currentFileMeta?.name}</p>

      {receivedFileUrl && (
        <a 
          href={receivedFileUrl} 
          download={currentFileMeta?.name}
          className="block w-full"
        >
          <Button className="w-full mb-4 !bg-emerald-600 hover:!bg-emerald-500" icon={<Download size={18} />}>
            下载文件
          </Button>
        </a>
      )}

      <Button variant="secondary" onClick={resetApp} className="w-full">
        发送其他文件
      </Button>
    </div>
  );

  const renderError = () => (
    <div className="glass-panel p-8 rounded-2xl max-w-md w-full text-center border-red-500/30">
      <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
        <XCircle className="w-8 h-8 text-red-500" />
      </div>
      <h3 className="text-xl font-bold text-red-400 mb-2">出错了！</h3>
      <p className="text-slate-300 mb-6">{errorMsg || "连接似乎断开了。"}</p>
      <Button variant="secondary" onClick={resetApp}>返回首页</Button>
    </div>
  );

  return (
    <div className="min-h-screen flex flex-col items-center relative overflow-hidden bg-slate-950">
      {/* Background Ambience */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10 pointer-events-none">
        <div className="absolute top-[-10%] left-[20%] w-[500px] h-[500px] bg-indigo-900/30 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-[-10%] right-[20%] w-[500px] h-[500px] bg-emerald-900/20 rounded-full blur-[100px]"></div>
      </div>

      <header className="w-full py-8 px-6 flex items-center justify-between max-w-6xl mx-auto z-10">
        <div className="flex items-center gap-2 cursor-pointer" onClick={() => appState !== AppState.TRANSFERRING && resetApp()}>
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
            <Zap className="text-white w-5 h-5" fill="currentColor" />
          </div>
          <span className="text-xl font-bold tracking-tight text-white">Nexus<span className="text-indigo-400">Drop</span></span>
        </div>
        <div className="text-xs font-mono text-slate-500 bg-slate-900/50 px-3 py-1 rounded-full border border-slate-800">
           P2P 加密 • 无服务器
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center w-full px-4 z-10 py-10">
        {appState === AppState.HOME && renderHome()}
        {appState === AppState.SENDER_LOBBY && renderSenderLobby()}
        {appState === AppState.RECEIVER_LOBBY && renderReceiverLobby()}
        {appState === AppState.TRANSFERRING && renderTransferring()}
        {appState === AppState.COMPLETED && renderCompleted()}
        {appState === AppState.ERROR && renderError()}
      </main>

      <footer className="w-full py-6 text-center text-slate-600 text-sm">
        <p>© 2024 NexusDrop. 技术支持：WebRTC & Gemini.</p>
      </footer>
    </div>
  );
};

export default App;