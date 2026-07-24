'use client';

import type { ProjectRecord } from '@/lib/models';

export function TokenProjectSelector({
  projects,
  selectedProjectNames,
  onToggle,
}: {
  projects: ProjectRecord[];
  selectedProjectNames: string[];
  onToggle: (projectName: string) => void;
}) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">功能组</legend>
      <div className="grid max-h-56 gap-2 overflow-y-auto rounded-xl border p-3 sm:grid-cols-2">
        {projects.map((project) => (
          <label
            key={project.id}
            className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted"
          >
            <input
              type="checkbox"
              checked={selectedProjectNames.includes(project.name)}
              className="size-4 accent-primary"
              onChange={() => onToggle(project.name)}
            />
            <span className="min-w-0 truncate" title={project.name}>
              {project.name}
            </span>
          </label>
        ))}
        {projects.length === 0 ? (
          <p className="col-span-full py-3 text-center text-sm text-muted-foreground">
            暂无可选功能组
          </p>
        ) : null}
      </div>
    </fieldset>
  );
}
