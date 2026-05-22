/** Ошибка: на сервере уже есть более новая версия проекта. */
export class ProjectSaveConflict extends Error {
  readonly serverUpdatedAt: string;
  readonly serverName: string;

  constructor(serverUpdatedAt: string, serverName: string) {
    super('CONFLICT');
    this.name = 'ProjectSaveConflict';
    this.serverUpdatedAt = serverUpdatedAt;
    this.serverName = serverName;
  }
}

export function isProjectSaveConflict(e: unknown): e is ProjectSaveConflict {
  return e instanceof ProjectSaveConflict;
}
