export enum AppState {
  HOME = 'HOME',
  SENDER_LOBBY = 'SENDER_LOBBY',
  RECEIVER_LOBBY = 'RECEIVER_LOBBY',
  TRANSFERRING = 'TRANSFERRING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export interface FileMetadata {
  name: string;
  size: number;
  type: string;
}

export interface TransferProgress {
  bytesTransferred: number;
  totalBytes: number;
  percentage: number;
}

export interface PeerMessage {
  type: 'METADATA' | 'FILE' | 'ACK';
  payload: any;
}

// Global Declaration for CDN libraries
declare global {
  interface Window {
    Peer: any;
    Html5Qrcode: any;
  }
}