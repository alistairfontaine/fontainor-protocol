import { createHash } from 'crypto';

export interface FileMetadata {
    fileName: string;
    hash: string;
    timestamp: number;
}

/**
 * Generates a SHA-256 hash for a file/buffer to ensure integrity.
 */
export function generateFileHash(data: Buffer): string {
    return createHash('sha256').update(data).digest('hex');
}

/**
 * Prepares the metadata object for the storage transaction.
 */
export function prepareMetadata(fileName: string, data: Buffer): FileMetadata {
    return {
        fileName,
        hash: generateFileHash(data),
        timestamp: Date.now(),
    };
}
