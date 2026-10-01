import prisma from '../db/prisma';

export interface UserTreeNode {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  managerId: string | null;
  managerName?: string;
  inspectionsCount: number;
  projectsCount: number;
  subordinates: UserTreeNode[];
}

export class AccessControlService {
  /**
   * Returns an array of user IDs accessible to the current user.
   * Returns null if user is ADMIN (unrestricted access).
   */
  static async getAccessibleUserIds(user: { id: string; role: string }): Promise<string[] | null> {
    if (user.role === 'ADMIN') {
      return null;
    }

    if (user.role === 'MANAGER') {
      const accessibleSet = new Set<string>([user.id]);
      const queue: string[] = [user.id];

      // Breadth-first traversal down the management tree
      while (queue.length > 0) {
        const currentManagerId = queue.shift()!;
        const directSubordinates = await prisma.user.findMany({
          where: { managerId: currentManagerId, isActive: true },
          select: { id: true },
        });

        for (const sub of directSubordinates) {
          if (!accessibleSet.has(sub.id)) {
            accessibleSet.add(sub.id);
            queue.push(sub.id);
          }
        }
      }

      return Array.from(accessibleSet);
    }

    // Default: Field staff / Inspector can only access their own data
    return [user.id];
  }

  /**
   * Returns an array of project IDs accessible to the current user.
   * Returns null if user is ADMIN (unrestricted access).
   */
  static async getAccessibleProjectIds(user: { id: string; role: string }): Promise<string[] | null> {
    if (user.role === 'ADMIN') {
      return null;
    }

    const accessibleUserIds = await this.getAccessibleUserIds(user);
    if (!accessibleUserIds || accessibleUserIds.length === 0) {
      return [];
    }

    // Project is accessible if:
    // 1. User (or subordinate) created it
    // 2. User (or subordinate) is assigned to it as a project member
    // 3. User (or subordinate) is assigned an inspection in it
    const projects = await prisma.project.findMany({
      where: {
        OR: [
          { createdById: { in: accessibleUserIds } },
          { assignedMembers: { some: { userId: { in: accessibleUserIds } } } },
          { inspections: { some: { inspectorId: { in: accessibleUserIds } } } },
        ],
      },
      select: { id: true },
    });

    return projects.map((p) => p.id);
  }

  /**
   * Checks if user has permission to access a specific project.
   */
  static async canAccessProject(user: { id: string; role: string }, projectId: string): Promise<boolean> {
    if (user.role === 'ADMIN') return true;

    const accessibleProjectIds = await this.getAccessibleProjectIds(user);
    if (!accessibleProjectIds) return true;
    return accessibleProjectIds.includes(projectId);
  }

  /**
   * Checks if user has permission to access a specific inspection.
   */
  static async canAccessInspection(user: { id: string; role: string }, inspectionId: string): Promise<boolean> {
    if (user.role === 'ADMIN') return true;

    const inspection = await prisma.inspection.findUnique({
      where: { id: inspectionId },
      select: { id: true, inspectorId: true, projectId: true },
    });
    if (!inspection) return false;

    const accessibleUserIds = await this.getAccessibleUserIds(user);
    if (!accessibleUserIds) return true;

    return accessibleUserIds.includes(inspection.inspectorId);
  }

  /**
   * Builds an organizational tree of users starting from managers down to field staff.
   */
  static async getHierarchyTree(user: { id: string; role: string }): Promise<UserTreeNode[]> {
    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        managerId: true,
        manager: { select: { fullName: true } },
        _count: {
          select: {
            assignedInspections: true,
            assignedProjects: true,
          },
        },
      },
      orderBy: { fullName: 'asc' },
    });

    const userMap = new Map<string, UserTreeNode>();

    for (const u of allUsers) {
      userMap.set(u.id, {
        id: u.id,
        fullName: u.fullName,
        email: u.email,
        role: u.role,
        isActive: u.isActive,
        managerId: u.managerId,
        managerName: u.manager?.fullName,
        inspectionsCount: u._count.assignedInspections,
        projectsCount: u._count.assignedProjects,
        subordinates: [],
      });
    }

    // Build parent-child relationships
    const rootNodes: UserTreeNode[] = [];

    for (const node of userMap.values()) {
      if (node.managerId && userMap.has(node.managerId)) {
        userMap.get(node.managerId)!.subordinates.push(node);
      } else {
        rootNodes.push(node);
      }
    }

    // If requester is a MANAGER, return tree rooted at this manager
    if (user.role === 'MANAGER') {
      const managerNode = userMap.get(user.id);
      return managerNode ? [managerNode] : [];
    }

    // If requester is INSPECTOR, return just themselves
    if (user.role === 'INSPECTOR') {
      const inspectorNode = userMap.get(user.id);
      return inspectorNode ? [inspectorNode] : [];
    }

    // For ADMIN, return full company tree
    return rootNodes;
  }
}
