import { GoogleGenAI } from "@google/genai";

/**
 * Generates a memorable, human-readable ID for the P2P session.
 * e.g., "cosmic-blue-falcon"
 */
export const generateConnectionPhrase = async (): Promise<string> => {
  try {
    // API Key must be obtained exclusively from process.env.API_KEY
    // Assume process.env.API_KEY is pre-configured and accessible.
    const apiKey = process.env.API_KEY;

    // If no API Key is found, throw immediately to trigger fallback
    if (!apiKey) {
      throw new Error("API Key not found in environment variable process.env.API_KEY");
    }

    // Initialize AI only when needed and safe
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    const model = 'gemini-2.5-flash';
    const prompt = "Generate a single, unique, 3-word hyphenated phrase (adjective-noun-noun or adjective-adjective-noun) that sounds sci-fi and cool for a temporary room code. Lowercase only. No spaces. Example: 'neon-cyber-wolf'. Return ONLY the string.";
    
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
    });

    // Reinforce explicit type for the 'text' property from the Gemini API response.
    // This addresses a common type error ('Type 'String' has no call signatures') that can occur
    // if 'response.text' is mistakenly called as a method, or if type inference is somehow confused,
    // despite current usage being correct as a property according to guidelines.
    const text: string | undefined = response.text;
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