import { auth } from "@/server/auth/config";
import { prisma } from "@/server/db/prisma";

const TARGET_EMAIL = "munirhossainedu@gmail.com";
const MINIMUM_PASSWORD_LENGTH = 12;
const MAXIMUM_PASSWORD_LENGTH = 128;

function requirePreviewBranch(): void {
  if (process.env.NEON_BRANCH !== "preview") {
    throw new Error('Refusing to run unless NEON_BRANCH is exactly "preview".');
  }
}

function readPassword(): string {
  const password = process.env.ADMIN_RESET_PASSWORD;

  if (!password) {
    throw new Error("ADMIN_RESET_PASSWORD is not set.");
  }

  if (
    password.length < MINIMUM_PASSWORD_LENGTH ||
    password.length > MAXIMUM_PASSWORD_LENGTH
  ) {
    throw new Error(
      `ADMIN_RESET_PASSWORD must be ${MINIMUM_PASSWORD_LENGTH}-${MAXIMUM_PASSWORD_LENGTH} characters.`,
    );
  }

  return password;
}

async function main(): Promise<void> {
  requirePreviewBranch();
  const password = readPassword();

  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL },
    select: {
      id: true,
      role: true,
      accounts: {
        where: { providerId: "credential" },
        select: {
          id: true,
          accountId: true,
        },
      },
    },
  });

  if (!user) {
    throw new Error(`User ${TARGET_EMAIL} was not found.`);
  }

  if (user.role !== "SUPER_ADMIN") {
    throw new Error(`User ${TARGET_EMAIL} is not a SUPER_ADMIN.`);
  }

  const credentialAccounts = user.accounts.filter(
    (account) => account.accountId === user.id,
  );

  if (credentialAccounts.length !== 1) {
    throw new Error(
      `Expected exactly one matching credential account; found ${credentialAccounts.length}.`,
    );
  }

  const passwordHash = await (await auth.$context).password.hash(password);
  const credentialAccount = credentialAccounts[0];

  await prisma.$transaction([
    prisma.account.update({
      where: { id: credentialAccount.id },
      data: { password: passwordHash },
    }),
    prisma.session.deleteMany({
      where: { userId: user.id },
    }),
  ]);

  console.log(`Reset password and revoked sessions for ${TARGET_EMAIL}.`);
}

main()
  .catch((error: unknown) => {
    console.error(
      "Admin password reset failed:",
      error instanceof Error ? error.message : "unexpected error",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
