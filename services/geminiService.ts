import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

/**
 * Generates a memorable, human-readable ID for the P2P session.
 * e.g., "cosmic-blue-falcon"
 */
export const generateConnectionPhrase = async (): Promise<string> => {
  try {
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
    console.error("Gemini ID generation failed, falling back to random:", error);
    // Fallback if API fails
    const adj = ['red', 'blue', 'fast', 'silent', 'cosmic', 'nano'];
    const noun = ['fox', 'ship', 'base', 'star', 'moon', 'link'];
    const random = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];
    return `${random(adj)}-${random(noun)}-${Math.floor(Math.random() * 999)}`;
  }
};