// src/hooks/useAudioUploader.js
import { useState, useCallback, useRef } from 'react';
import { uploadInChunks } from '../lib/audioUploadEngine.js';

/**
 * 🔥 PHASE 2: REACT FULL-STACK AUDIO INGRESS STATE HOOK 🔥
 * Binds the pure binary chunk logic engine securely to your React UI viewports.
 * Enforces strict button busy-locks and provides real-time progress indicators.
 */
export function useAudioUploader(apiBase = '') {
  const [isUploading, setIsUploading] = useState(false);

  const [progress, setProgress] = useState(0); // Tracks 0-100 percentage ratios
  const [eta, setEta] = useState(0);           // Time remaining in milliseconds
  const [audioUri, setAudioUri] = useState(null);
  const [error, setError] = useState(null);

  // Use a persistent reference pointer to manage multi-step cancellation states safely
  const cancelRef = useRef(false);

  const cancelUpload = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const uploadTrack = useCallback(async (file) => {
    // Reset state parameters and trigger a rigid hardware execution busy-lock
    setIsUploading(true);
    setProgress(0);
    setEta(0);
    setAudioUri(null);
    setError(null);
    cancelRef.current = false;

    // Generate a unique, un-mangled session upload tracker ID stamp
    const uploadId = `fontainor-session-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const result = await uploadInChunks(file, {
      uploadId,
      apiBase,
      shouldCancel: () => cancelRef.current,
      onProgress: (telemetry) => {
        // Feed the live progress metrics straight into the React viewports
        setProgress(telemetry.percent);
        setEta(telemetry.etaMs);
      }
    });

    // Release execution threads
    setIsUploading(false);

    if (result.ok) {
      setAudioUri(result.audioUri);
      return { success: true, audioUri: result.audioUri };
    } else {
      setError(result.message);
      return { success: false, error: result.message };
    }
  }, [apiBase]);

  return {
    uploadTrack,
    cancelUpload,
    isUploading,
    progress,
    eta,
    audioUri,
    error
  };
}
