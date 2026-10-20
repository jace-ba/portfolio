import { getCollection } from 'astro:content';

export async function getProjects() {
  const projects = await getCollection('projects');
  return projects.sort((a, b) => a.data.order - b.data.order);
}

/** Projects with their own detail page. */
export async function getMainProjects() {
  return (await getProjects()).filter((p) => p.data.kind === 'project');
}

/** Cards in the For fun section. */
export async function getSmallBuilds() {
  return (await getProjects()).filter((p) => p.data.kind === 'small');
}
