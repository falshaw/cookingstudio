import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { PageHeader } from "@/components/ui";
import { KeysClient } from "@/components/KeysClient";

export default async function KeysPage() {
  const me = (await currentUser())!;
  const keys = await prisma.apiKey.findMany({
    where: { userId: me.id },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, hint: true, scopes: true, expiresAt: true, lastUsedAt: true, createdAt: true },
  });
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="For scripts and assistants" title="API keys">
        A key lets a script or an AI assistant log food, weight and shopping for you through the app — only your own data, only what you tick. Delete a key and it stops at once.
      </PageHeader>
      <KeysClient
        keys={keys.map((k) => ({ ...k, expiresAt: k.expiresAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, createdAt: k.createdAt.toISOString() }))}
      />
    </div>
  );
}
