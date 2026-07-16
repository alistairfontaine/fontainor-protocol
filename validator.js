// validator.js
import { z } from 'zod';

/**
 * 🔥 MILESTONE B1-B3: HARDENED PROTOCOL METADATA SPECIFICATION SCHEMA 🔥
 * Enforces rigid structural validation constraints over incoming music metadata.
 * Guards the on-chain registry against malformed vectors, inflation attacks, and broken URIs.
 */
export const releaseSchema = z.object({
  title: z.string()
    .min(1, { message: "Track Title cannot be empty." })
    .max(100, { message: "Track Title exceeds safe length threshold (Max 100 chars)." })
    .trim(),

  artist: z.string()
    .min(1, { message: "Artist Name cannot be empty." })
    .max(100, { message: "Artist Name exceeds safe length threshold (Max 100 chars)." })
    .trim(),

  price: z.number()
    .nonnegative({ message: "Price parameter must be a positive numeric value." })
    .max(1000000, { message: "Price exceeds safe economic thresholds." }),

  currency: z.enum(['USD', 'SOL', 'USDC'], {
    errorMap: () => ({ message: "Unsupported currency asset. Supported values: USD, SOL, USDC." })
  }),

  total: z.number()
    .int({ message: "Editions calculation must be a clean integer value." })
    .nonnegative({ message: "Editions footprint cannot be negative (0 indicates open edition)." }),

  // Enforce strict permanent Arweave gateway hashing constraints via optimized regular expressions
  audioUri: z.string()
    .min(1, { message: "Audio track file link is required to register a release." })
    .regex(/^https:\/\/arweave\.net\/[a-zA-Z0-9_-]{43}$/, {
      message: "Audio URI must conform to a valid permanent Arweave gateway address structure (https://arweave.net)."
    }),

  coverUri: z.string()
    .regex(/^(https:\/\/arweave\.net\/[a-zA-Z0-9_-]{43})?$/, {
      message: "Cover Artwork URI must point to a valid Arweave gateway location or remain completely empty."
    })
    .optional()
    .or(z.literal(''))
});

/**
 * Express middleware gateway rule.
 * intercepting incoming request bodies and parsing payloads before database commit.
 */
export const validateUpload = (req, res, next) => {
  // Validate a single release object payload frame incoming from the PublishModal UI
  const result = releaseSchema.safeParse(req.body);

  if (!result.success) {
    console.error("❌ ZOD PROTOCOL VALIDATION MISMATCH:", result.error.format());

    // Return a structured 400 Bad Request directly to the UI's ValidationDetails panel
    return res.status(400).json({
      ok: false,
      msg: "Metadata validation rejected: asset specifications do not meet protocol standards.",
      details: result.error.format()
    });
  }

  // If the payload payload clears all validation parameters, strip down unwanted fields and pass control
  req.body = result.data;
  next();
};
