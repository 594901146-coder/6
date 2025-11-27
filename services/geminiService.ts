import { GoogleGenAI } from "@google/genai";

/**
 * Safely retrieves the API Key from various environment configurations
 * without crashing the browser if 'process' is undefined.
 */
const getApiKeySafe = (): string => {
  try {
    // 1. Check for Vite environment (common in Vercel deployments)
    // @ts-ignore
    if (typeof import.meta !== 'undefined' && import.meta.env) {
      // @ts-ignore
      const viteKey = import.meta.env.VITE_API_KEY || import.meta.env.NEXT_PUBLIC_API_KEY || import.meta.env.API_KEY;
      if (viteKey) return viteKey;
    }

    // 2. Check for Standard Node/Webpack environment
    if (typeof process !== 'undefined' && process.env) {
      const nodeKey = process.env.API_KEY || process.env.REACT_APP_API_KEY;
      if (nodeKey) return nodeKey;
    }
  } catch (e) {
    // Silently fail if accessing these variables causes a security error or reference error
    console.warn("Could not read environment variables safely:", e);
  }
  return '';
};

/**
 * Generates a memorable, human-readable ID for the P2P session.
 * e.g., "cosmic-blue-falcon"
 */
export const generateConnectionPhrase = async (): Promise<string> => {
  try {
    const apiKey = getApiKeySafe();

    // If no API Key is found, throw immediately to trigger fallback
    if (!apiKey) {
      throw new Error("API Key not found in environment (VITE_API_KEY, NEXT_PUBLIC_API_KEY, or API_KEY)");
    }

    // Initialize AI only when needed and safe
    const ai = new GoogleGenAI({ apiKey });
    
    const model = 'gemini-2.5-flash';
    const prompt = "Generate a single, unique, 3-word hyphenated phrase (adjective-noun-noun or adjective-adjective-noun) that sounds sci-fi and cool for a temporary room code. Lowercase only. No spaces. Example: 'neon-cyber-wolf'. Return ONLY the string.";
    
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });

    const text = response.text;
    if (text) {
      // Clean up any accidental whitespace or newlines
      const cleanId = text.trim().toLowerCase().replace(/[^a-z-]/g, '');
      // Append a small random number to ensure uniqueness on the public PeerServer
      const suffix = Math.floor(Math.random() * 999);
      return `${cleanId}-${suffix}`;
    }
    
    throw new Error("Empty response from Gemini");
  } catch (error) {
    console.error("Gemini ID generation failed or Key missing, falling back to random:", error);
    // Fallback if API fails or key is missing - entirely client side, no API needed
    const adj = ['red', 'blue', 'fast', 'silent', 'cosmic', 'nano', 'hyper', 'solar', 'cyber', 'neon'];
    const noun = ['fox', 'ship', 'base', 'star', 'moon', 'link', 'core', 'wave', 'bot', 'grid'];
    const random = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    return `${random(adj)}-${random(noun)}-${Math.floor(Math.random() * 9999)}`;
  }
};