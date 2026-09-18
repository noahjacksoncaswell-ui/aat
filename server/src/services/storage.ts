import fs from "fs";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env, isS3Configured } from "../config/env";

const LOCAL_UPLOAD_DIR = path.join(__dirname, "..", "..", "uploads");

let s3Client: S3Client | null = null;
function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: env.s3Region,
      endpoint: env.s3Endpoint || undefined,
      forcePathStyle: env.s3ForcePathStyle,
      credentials: {
        accessKeyId: env.s3AccessKeyId,
        secretAccessKey: env.s3SecretAccessKey,
      },
    });
  }
  return s3Client;
}

/**
 * Document storage abstraction. Uses S3 (or any S3-compatible endpoint, e.g.
 * MinIO) when credentials are configured; otherwise falls back to local disk
 * so the platform is runnable in local/dev environments without cloud
 * credentials. Swapping S3_* env vars in is a drop-in upgrade - no code change.
 */
export const storage = {
  isRemote: isS3Configured(),

  async putObject(key: string, buffer: Buffer, contentType: string): Promise<void> {
    if (isS3Configured()) {
      await getClient().send(
        new PutObjectCommand({
          Bucket: env.s3Bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        })
      );
      return;
    }
    const fullPath = path.join(LOCAL_UPLOAD_DIR, key);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, buffer);
  },

  async getObjectStream(key: string) {
    if (isS3Configured()) {
      const res = await getClient().send(new GetObjectCommand({ Bucket: env.s3Bucket, Key: key }));
      return res.Body;
    }
    const fullPath = path.join(LOCAL_UPLOAD_DIR, key);
    return fs.createReadStream(fullPath);
  },

  async deleteObject(key: string): Promise<void> {
    if (isS3Configured()) {
      await getClient().send(new DeleteObjectCommand({ Bucket: env.s3Bucket, Key: key }));
      return;
    }
    const fullPath = path.join(LOCAL_UPLOAD_DIR, key);
    if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
  },

  async getSignedDownloadUrl(key: string, fileName: string): Promise<string | null> {
    if (isS3Configured()) {
      return getSignedUrl(
        getClient(),
        new GetObjectCommand({
          Bucket: env.s3Bucket,
          Key: key,
          ResponseContentDisposition: `inline; filename="${fileName}"`,
        }),
        { expiresIn: 60 * 10 }
      );
    }
    return null; // local files are streamed through the API route instead
  },
};
