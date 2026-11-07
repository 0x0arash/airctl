export {
  FilesystemProjectDetector,
  projectByCwd,
  projectForProcess,
  expandHome,
  findGitRoot,
} from "./detect.js";
export type { ProjectDetector } from "./detect.js";
export { PROJECT_MARKERS, FRAMEWORK_FILES } from "./markers.js";
