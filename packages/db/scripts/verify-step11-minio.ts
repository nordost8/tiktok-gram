import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { MEDIA_CACHE_BUCKET, mediaObjectKey } from "../src/media-storage";

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Missing env ${name}`);
  }
  return value;
}

function createClient() {
  const endpoint = env("S3_ENDPOINT", "http://127.0.0.1:9000");
  return new S3Client({
    endpoint,
    region: env("S3_REGION", "us-east-1"),
    credentials: {
      accessKeyId: env("S3_ACCESS_KEY_ID", "tiktok_gram_minio"),
      secretAccessKey: env("S3_SECRET_ACCESS_KEY", "tiktok_gram_minio_dev_secret"),
    },
    forcePathStyle: true,
  });
}

async function readBody(body: unknown): Promise<string> {
  if (!body || typeof body !== "object" || !("transformToByteArray" in body)) {
    throw new Error("Unexpected S3 body");
  }
  const bytes = await (
    body as { transformToByteArray: () => Promise<Uint8Array> }
  ).transformToByteArray();
  return new TextDecoder().decode(bytes);
}

async function main() {
  const bucket = env("S3_BUCKET", MEDIA_CACHE_BUCKET);
  const client = createClient();

  await client.send(new HeadBucketCommand({ Bucket: bucket }));

  const testMediaId = "00000000-0000-4000-8000-000000000099";
  const objectKey = mediaObjectKey(testMediaId, "txt");
  const payload = `step11-verify-${Date.now()}`;

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: objectKey,
      Body: payload,
      ContentType: "text/plain",
      Metadata: { purpose: "verify-step11" },
    }),
  );

  const head = await client.send(
    new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
  );
  if (head.ContentLength !== Buffer.byteLength(payload, "utf8")) {
    throw new Error(
      `HeadObject size mismatch: expected ${payload.length}, got ${head.ContentLength}`,
    );
  }

  const got = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: objectKey }),
  );
  const text = await readBody(got.Body);
  if (text !== payload) {
    throw new Error(`GetObject content mismatch: "${text}" !== "${payload}"`);
  }

  let missingOk = false;
  try {
    await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: `${objectKey}.missing` }),
    );
  } catch (error) {
    if (
      error instanceof NotFound ||
      (error as { name?: string }).name === "NoSuchKey" ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    ) {
      missingOk = true;
    } else {
      throw error;
    }
  }
  if (!missingOk) {
    throw new Error("Expected 404 for missing object key");
  }

  await client.send(
    new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
  );

  let deletedOk = false;
  try {
    await client.send(
      new HeadObjectCommand({ Bucket: bucket, Key: objectKey }),
    );
  } catch (error) {
    if (
      error instanceof NotFound ||
      (error as { name?: string }).name === "NotFound" ||
      (error as { $metadata?: { httpStatusCode?: number } }).$metadata
        ?.httpStatusCode === 404
    ) {
      deletedOk = true;
    } else {
      throw error;
    }
  }
  if (!deletedOk) {
    throw new Error("Object still exists after delete");
  }

  console.log(
    JSON.stringify({
      ok: true,
      bucket,
      endpoint: env("S3_ENDPOINT", "http://127.0.0.1:9000"),
      objectKey,
      mediaObjectKeyExample: mediaObjectKey(
        "ce06eea7-1efb-4678-97ec-9e3de7d71194",
        "mp4",
      ),
    }),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
