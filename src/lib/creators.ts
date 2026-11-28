import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import type { AssignedEmployee, CreatorAssignment } from "@/lib/creator-assignments";

export type { AssignedEmployee, CreatorAssignment };

export const listCreatorAssignments = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ rows: CreatorAssignment[]; staff: AssignedEmployee[]; allowed: boolean }> => {
    const { staffContext } = await import("@/lib/employees-runtime.server");
    const { listAssignableStaff, listCreatorAssignments: read, canManageCreators } = await import("@/lib/creator-assignments");
    const { sql, actor } = await staffContext(context.userId);
    if (!canManageCreators(actor)) return { rows: [], staff: [], allowed: false };
    const [rows, staff] = await Promise.all([read(sql, actor), listAssignableStaff(sql, actor)]);
    return { rows, staff, allowed: true };
  });

export const setCreatorAssignees = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { creatorId: string; userIds: string[] }) => input)
  .handler(async ({ context, data }): Promise<{ rows: CreatorAssignment[] }> => {
    const { staffContext } = await import("@/lib/employees-runtime.server");
    const { setCreatorAssignees: write } = await import("@/lib/creator-assignments");
    const { sql, actor } = await staffContext(context.userId);
    return { rows: await write(sql, actor, data.creatorId, data.userIds) };
  });
