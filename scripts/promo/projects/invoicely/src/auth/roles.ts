export type Role = 'owner' | 'admin' | 'accountant' | 'viewer';
export type Permission = 'invoices:read' | 'invoices:write' | 'billing:manage' | 'team:manage';

const GRANTS: Record<Role, Permission[]> = {
  owner: ['invoices:read', 'invoices:write', 'billing:manage', 'team:manage'],
  admin: ['invoices:read', 'invoices:write', 'team:manage'],
  accountant: ['invoices:read', 'invoices:write'],
  viewer: ['invoices:read'],
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].includes(permission);
}

export function rolesWith(permission: Permission): Role[] {
  return (Object.keys(GRANTS) as Role[]).filter((role) => can(role, permission));
}
