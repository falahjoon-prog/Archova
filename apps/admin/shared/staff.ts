'use client';

import { createContext, useContext } from 'react';
import type { StaffDto } from '@archova/contracts';

export const StaffContext = createContext<StaffDto | null>(null);

export function useStaff(): StaffDto {
  const s = useContext(StaffContext);
  if (!s) throw new Error('useStaff needs a signed-in console');
  return s;
}

export const can = (staff: StaffDto, permission: string) => staff.permissions.includes(permission);
