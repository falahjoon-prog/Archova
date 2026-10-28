import type { CollectionConfig } from 'payload';
import { isAdmin, isStaff } from '../lib/access';

/** Website staff. Production sign-in moves behind the staff IdP (ADR-0008); local run uses email and password. */
export const Users: CollectionConfig = {
  slug: 'users',
  auth: { tokenExpiration: 8 * 60 * 60, maxLoginAttempts: 5, lockTime: 10 * 60 * 1000 },
  admin: { useAsTitle: 'email', defaultColumns: ['email', 'name', 'role'] },
  access: { read: isStaff, create: isAdmin, update: isAdmin, delete: isAdmin },
  fields: [
    { name: 'name', type: 'text' },
    {
      name: 'role',
      type: 'select',
      required: true,
      defaultValue: 'author',
      options: [
        { label: 'Author (drafts)', value: 'author' },
        { label: 'Editor (publishes)', value: 'editor' },
        { label: 'Admin (menus, settings, users)', value: 'admin' },
      ],
    },
  ],
};
