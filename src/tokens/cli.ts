import { getRoleRepository } from '../db/roleRepository';
import { getTokenRepository } from '../db/tokenRepository';
import { parsePermissions } from '../auth/permissions';

const PERMISSIONS_HELP = [
  'worlds:read   Read world records',
  'worlds:write  Add, delete, and update world records',
  'tags:read     List all tags',
  'tags:write    Set tags on a world record',
  'meta:read     Read dataset metadata counts'
].join('\n');

function parseArgs(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = 'true';
      }
    }
  }
  return flags;
}

function splitList(value: string | undefined): string[] {
  return value
    ? value
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean)
    : [];
}

function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requireFlag(flags: Record<string, string>, name: string): string {
  const value = flags[name];
  if (!value || value === 'true') {
    fail(`missing required flag --${name}`);
  }
  return value;
}

function printUsage(command?: string): void {
  const sections: Record<string, string> = {
    'token:create': `Usage: pnpm token:create -- --name <name> --role <role>
  Create a token. The raw token is printed once and cannot be recovered later.
  Roles: ${getRoleRepository()
    .list()
    .map((r) => r.name)
    .join(', ')}`,
    'token:list': `Usage: pnpm token:list
  List tokens with role, created, last used, and revoked status.`,
    'token:revoke': `Usage: pnpm token:revoke -- --name <name>
  Revoke a token. Already-revoked tokens are a no-op.`,
    'role:list': `Usage: pnpm role:list
  List roles with their permissions.`,
    'role:create': `Usage: pnpm role:create -- --name <name> --perms <perm1,perm2>
  Create a role with the given permissions.

  Permissions:
${PERMISSIONS_HELP}`,
    'role:update': `Usage: pnpm role:update -- --name <name> [--add <perm1,perm2>] [--remove <perm1,perm2>]
  Add or remove permissions on a role. Changes apply to every token with the role.

  Permissions:
${PERMISSIONS_HELP}`
  };

  const lines = Object.entries(sections).map(
    ([key, text]) => `\n${key}\n${'='.repeat(key.length)}\n${text}\n`
  );
  if (command && sections[command]) {
    console.log(sections[command]);
  } else {
    console.log(
      `sos-world-tagger-api token CLI\n\nCommands:\n${Object.keys(sections).join('\n')}`
    );
    console.log(lines.join('\n'));
  }
}

function requireRole(name: string) {
  const role = getRoleRepository().findByName(name);
  if (!role) fail(`role "${name}" does not exist`);
  return role;
}

function cmdTokenCreate(args: string[]): void {
  const flags = parseArgs(args);
  if (flags.help) return printUsage('token:create');
  const name = requireFlag(flags, 'name');
  const roleName = requireFlag(flags, 'role');
  const role = requireRole(roleName);
  const { rawToken, record } = getTokenRepository().create(name, role);
  console.log(`token "${record.name}" created with role "${role.name}"`);
  console.log(rawToken);
}

function cmdTokenList(): void {
  const tokens = getTokenRepository().list();
  if (tokens.length === 0) {
    console.log('no tokens');
    return;
  }
  for (const token of tokens) {
    const revoked = token.revokedAt ? ' (revoked)' : '';
    console.log(
      `${token.name}\t${token.role.name}\tcreated ${new Date(token.createdAt * 1000).toISOString()}\tlast used ${token.lastUsedAt ? new Date(token.lastUsedAt * 1000).toISOString() : 'never'}${revoked}`
    );
  }
}

function cmdTokenRevoke(args: string[]): void {
  const flags = parseArgs(args);
  if (flags.help) return printUsage('token:revoke');
  const name = requireFlag(flags, 'name');
  if (getTokenRepository().revoke(name)) {
    console.log(`token "${name}" revoked`);
  } else {
    fail(`token "${name}" not found or already revoked`);
  }
}

function cmdRoleList(): void {
  const roles = getRoleRepository().list();
  if (roles.length === 0) {
    console.log('no roles');
    return;
  }
  for (const role of roles) {
    console.log(`${role.name}\t[${role.permissions.join(', ')}]`);
  }
}

function cmdRoleCreate(args: string[]): void {
  const flags = parseArgs(args);
  if (flags.help) return printUsage('role:create');
  const name = requireFlag(flags, 'name');
  const perms = parsePermissions(splitList(flags.perms));
  const role = getRoleRepository().create(name, perms);
  console.log(
    `role "${role.name}" created with [${role.permissions.join(', ')}]`
  );
}

function cmdRoleUpdate(args: string[]): void {
  const flags = parseArgs(args);
  if (flags.help) return printUsage('role:update');
  const name = requireFlag(flags, 'name');
  const add = parsePermissions(splitList(flags.add));
  const remove = parsePermissions(splitList(flags.remove));
  if (add.length === 0 && remove.length === 0) {
    fail('provide at least one of --add or --remove');
  }
  const role = getRoleRepository().updatePermissions(name, add, remove);
  if (!role) fail(`role "${name}" does not exist`);
  console.log(
    `role "${name}" permissions now [${role.permissions.join(', ')}]`
  );
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'token:create':
    cmdTokenCreate(rest);
    break;
  case 'token:list':
    cmdTokenList();
    break;
  case 'token:revoke':
    cmdTokenRevoke(rest);
    break;
  case 'role:list':
    cmdRoleList();
    break;
  case 'role:create':
    cmdRoleCreate(rest);
    break;
  case 'role:update':
    cmdRoleUpdate(rest);
    break;
  case 'help':
  case undefined:
    printUsage();
    break;
  default:
    fail(`unknown command "${command}". Run "pnpm token-cli" for usage.`);
}
