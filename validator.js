import { z } from 'zod';

// Define the new fileMetadata schema
const fileMetadataSchema = z.object({
  fileName: z.string(),
  hash: z.string(),
  timestamp: z.number(),
});

export const registrySchema = z.array(z.object({
  id: z.string(),
  title: z.string(),
  artist: z.string(),
  price: z.object({
    amount: z.number(),
    currency: z.string()
  }),
  editions: z.object({
    total: z.number()
  }),
  status: z.string(),
  date: z.string(),
  audioUri: z.string().url().optional().nullable(),
  coverUri: z.string().url().optional().nullable(),
  // New optional field added here:
  fileMetadata: fileMetadataSchema.optional(),
}));

export const validateUpload = (req, res, next) => {
  const result = registrySchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: "Invalid Registry Structure", details: result.error.format() });
  }
  next();
};
