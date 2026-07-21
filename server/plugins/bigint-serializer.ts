/**
 * Global BigInt JSON serializer.
 *
 * Prisma BigInt fields (Video.fileSizeBytes, VideoAsset.fileSizeBytes,
 * AppReferenceImage.fileSizeBytes) ломают JSON.stringify в Nitro/h3 при
 * сериализации ответов. Patch BigInt.prototype.toJSON делает их строкой —
 * безопасный roundtrip для значений > 2^53 (Number теряет точность).
 *
 * Клиент должен явно конвертировать: Number(video.fileSizeBytes) / 1024.
 */

declare global {
  interface BigInt {
    toJSON(): string;
  }
}

export default defineNitroPlugin(() => {
  if (typeof (BigInt.prototype as any).toJSON === "undefined") {
    Object.defineProperty(BigInt.prototype, "toJSON", {
      value: function (this: bigint) {
        return this.toString();
      },
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
});
