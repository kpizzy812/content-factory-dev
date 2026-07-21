-- CreateEnum
CREATE TYPE "ProxyProtocol" AS ENUM ('http', 'https', 'socks5');

-- AlterTable
ALTER TABLE "Proxy" ADD COLUMN     "protocol" "ProxyProtocol" NOT NULL DEFAULT 'http';
