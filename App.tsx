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
  Zap
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

  // Refs for PeerJS objects (not state to avoid re-renders)
  const peerRef = useRef<any>(null);
  const connRef = useRef<any>(null);
  const receivedChunksRef = useRef<BlobPart[]>([]);
  const receivedSizeRef = useRef<number>(0);

  // --- HELPER: Initialize Peer ---
  const initializePeer = useCallback((id?: string) => {
    if (peerRef.current) return peerRef.current;

    const peer = new window.Peer(id, {
      debug: 1,
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
      setErrorMsg(`连接错误: ${err.type}`);
      setAppState(AppState.ERROR);
    });

    peerRef.current = peer;
    return peer;
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
  };

  // --- HELPER: Handle Incoming Data ---
  const handleData = (data: any) => {
    // 1. Metadata packet
    if (data.type === 'METADATA') {
      const meta = data.payload as FileMetadata;
      setCurrentFileMeta(meta);
      receivedChunksRef.current = [];
      receivedSizeRef.current = 0;
      setAppState(AppState.TRANSFERRING);
      setTransferProgress(0);
      
      // Auto-ack to start transfer
      connRef.current.send({ type: 'ACK' });
    } 
    // 2. Acknowledgement
    else if (data.type === 'ACK') {
      startFileTransfer();
    }
    // 3. File Chunk (Binary)
    else if (data.constructor === ArrayBuffer || data.constructor === Uint8Array || data instanceof Blob) {
      if (!currentFileMeta) return;

      const chunk = data instanceof Blob ? data : new Blob([data]);
      receivedChunksRef.current.push(chunk);
      receivedSizeRef.current += chunk.size;

      // Calculate progress
      const progress = (receivedSizeRef.current / currentFileMeta.size) * 100;
      setTransferProgress(progress);

      if (receivedSizeRef.current >= currentFileMeta.size) {
        finishReception();
      }
    }
  };

  // --- SENDER ACTIONS ---

  const startAsSender = async () => {
    setIsGeneratingId(true);
    try {
      const id = await generateConnectionPhrase();
      initializePeer(id);
      setAppState(AppState.SENDER_LOBBY);
    } catch (e) {
      setErrorMsg("初始化发送模式失败。");
    } finally {
      setIsGeneratingId(false);
    }
  };

  const onFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setFiles(Array.from(e.target.files));
    }
  };

  const initiateTransfer = () => {
    if (!connRef.current || files.length === 0) return;
    const file = files[0];
    
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
    const file = files[0];
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
    if (!currentFileMeta) return;
    const blob = new Blob(receivedChunksRef.current, { type: currentFileMeta.type });
    const url = URL.createObjectURL(blob);
    setReceivedFileUrl(url);
    setAppState(AppState.COMPLETED);
  };

  const resetApp = () => {
     // Clean up
     if (peerRef.current) peerRef.current.destroy();
     peerRef.current = null;
     connRef.current = null;
     setAppState(AppState.HOME);
     setFiles([]);
     setReceivedFileUrl(null);
     setTransferProgress(0);
     setConnectionStatus('Disconnected');
     setTargetPeerId('');
  };

  // --- RENDERERS ---

  const renderHome = () => (
    <div className="flex flex-col md:flex-row gap-8 max-w-4xl w-full">
      <div 
        onClick={startAsSender}
        className="flex-1 cursor-pointer group hover:scale-[1.02] transition-transform duration-300"
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
        onClick={startAsReceiver}
        className="flex-1 cursor-pointer group hover:scale-[1.02] transition-transform duration-300"
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
      
      <div className="bg-slate-900/50 p-6 rounded-xl border border-slate-700 mb-8 text-center">
        <p className="text-sm text-slate-400 mb-2 uppercase tracking-wider font-semibold">分享此口令</p>
        <div className="flex items-center justify-center gap-3">
          <span className="text-3xl font-mono font-bold text-white tracking-tight">{peerId}</span>
          <button 
            onClick={() => navigator.clipboard.writeText(peerId)}
            className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
            title="复制到剪贴板"
          >
            <Copy size={20} />
          </button>
        </div>
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
              <p className="font-medium text-white truncate max-w-full">{files[0].name}</p>
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
    <div className="glass-panel p-8 rounded-2xl max-w-lg w-full">
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
      <p className="text-slate-400 mb-8">{currentFileMeta?.name}</p>
      
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
      <p className="text-slate-400 mb-8">{currentFileMeta?.name}</p>

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
      <Button variant="secondary" onClick={resetApp}>重试</Button>
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