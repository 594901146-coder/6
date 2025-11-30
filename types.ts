export enum AppState {
  HOME = 'HOME',
  SETUP = 'SETUP', // Replaces SENDER/RECEIVER LOBBY for initial setup
  CHAT = 'CHAT',   // The main chat room view
  ERROR = 'ERROR'
}

export interface FileMetadata {
  id: string; // Unique ID for the file transfer
  name: string;
  size: number;
  type: string;
}

export interface ChatMessage {
  id: string;
  sender: 'me' | 'peer';
  type: 'text' | 'file';
  content?: string; // For text messages
  fileMeta?: FileMetadata; // For file transfers
  fileUrl?: string; // For completed downloads
  progress?: number; // 0-100 for file transfers
  timestamp: number;
  status?: 'waiting' | 'transferring' | 'completed' | 'error';
}

export interface PeerMessage {
  type: 'TEXT' | 'FILE_START' | 'FILE_CHUNK' | 'ACK';
  payload: any;
}

// Global Declaration for CDN libraries
declare global {
  interface Window {
    Peer: any;
    Html5Qrcode: any;
    Html5QrcodeSupportedFormats: {
      QR_CODE: string;
      // Other formats if needed
    };
  }
}