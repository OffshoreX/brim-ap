// Local input/output shapes for the approval chain so the rule does not depend on the DB schema.
export type ChainUser = {
  id: string;
  role: string; // 'finance_manager' | 'controller_admin' | 'cfo' | ...
  departmentId?: string;
  managerId?: string;
  status: 'active' | 'on_leave' | 'terminated';
  delegateId?: string;
};
export type ChainDepartment = { id: string; managerUserId: string };
export type ChainVendor = { status: string; category: string; onboardedAt?: string }; // onboardedAt: ISO yyyy-mm-dd
export type ChainInvoice = { totalCadCents: number; date: string }; // date: ISO yyyy-mm-dd
// An invoice goes up a level when its total is OVER the threshold (exactly at it stays below).
export type ChainThresholds = { financeOverCents: number; controllerOverCents: number; cfoOverCents: number };

export type ChainStep = { stepNo: number; role: string; userId: string; reason: string; delegatedFrom?: string };
