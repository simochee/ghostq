import { homedir } from "node:os";
import { join, resolve } from "node:path";

export function configHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

export function overlayRoot(): string {
  return process.env.GHOSTQ_ROOT || join(configHome(), "ghostq", "overlay");
}

export function ghostqDir(): string {
  return join(configHome(), "ghostq");
}

export function templateDir(): string {
  return join(configHome(), "ghostq", "template");
}

export function expandTilde(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function samePath(a: string, b: string): boolean {
  return resolve(expandTilde(a)) === resolve(expandTilde(b));
}
