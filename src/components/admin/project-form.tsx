import { saveProjectAction } from "@/app/(admin)/admin/cms-actions";
import { AdminForm } from "@/components/admin/admin-form";
import {
  areaClass,
  buttonClass,
  inputClass,
} from "@/components/admin/admin-shell";
import { ProjectMediaPicker } from "@/components/admin/project-media-picker";
import { ProjectVideoField } from "@/components/admin/project-video-field";
import { toVideoRef, videoSourceUrl, type VideoProvider } from "@/lib/video";
type Category = { id: string; name: string };
type Media = { id: string; originalName: string; altText: string | null };
type Project = {
  id: string;
  title: string;
  slug: string;
  summary: string;
  description: string;
  clientName: string | null;
  location: string | null;
  projectDate: Date | null;
  categoryId: string;
  status: "DRAFT" | "PUBLISHED";
  featured: boolean;
  sortOrder: number;
  seoTitle: string | null;
  seoDescription: string | null;
  videoProvider: VideoProvider | null;
  videoId: string | null;
  videoTitle: string | null;
  updatedAt: Date;
  media: { mediaId: string }[];
};
const hintClass = "mt-1 block text-xs text-muted-foreground";
/**
 * The project editor used by New project and Edit project.
 *
 * The everyday fields are always visible; everything else sits in a native
 * `<details>` that starts closed. Every advanced field is still submitted with
 * its current value, so saving never clears what is hidden. The category is
 * chosen automatically for a new project unless the editor picks one (see
 * `decideProjectCategory`); an existing project's category is preselected and
 * kept. An empty slug on a
 * new project is generated from the title by the save action; an existing slug
 * is shown as-is and only changes if the editor changes it.
 */
export function ProjectForm({
  project,
  categories,
  media,
}: {
  project?: Project;
  categories: Category[];
  media: Media[];
}) {
  const selectedMediaIds = project?.media.map((item) => item.mediaId) ?? [];
  const storedVideo = project ? toVideoRef({ provider: project.videoProvider, videoId: project.videoId, title: project.videoTitle }) : null;
  // A title saved earlier is kept; without one, the public player names the
  // film after the project title.
  const savedVideoTitle = storedVideo?.title ?? "";
  return (
    <AdminForm action={saveProjectAction} className="grid max-w-3xl gap-5">
      {project && <input type="hidden" name="id" value={project.id} />}
      {project && (
        <input
          type="hidden"
          name="expectedUpdatedAt"
          value={project.updatedAt.toISOString()}
        />
      )}
      <label>
        Project title
        <input
          className={inputClass}
          name="title"
          defaultValue={project?.title}
          maxLength={160}
          required
        />
      </label>
      <label>
        Short description
        <textarea
          aria-describedby="project-summary-hint"
          className={areaClass}
          name="summary"
          defaultValue={project?.summary}
          maxLength={500}
          required
        />
        <span className={hintClass} id="project-summary-hint">
          One or two sentences shown under the title and on project cards.
        </span>
      </label>
      <ProjectVideoField
        initialUrl={storedVideo ? videoSourceUrl(storedVideo) ?? "" : ""}
        savedTitle={savedVideoTitle}
      />
      <ProjectMediaPicker
        initialMediaIds={selectedMediaIds}
        media={media}
      />
      <label className="flex min-h-10 items-center gap-3">
        <input
          aria-describedby="project-publish-hint"
          className="size-5"
          type="checkbox"
          name="status"
          value="PUBLISHED"
          defaultChecked={project?.status === "PUBLISHED"}
        />
        <span>
          Publish on the website
          <span className={hintClass} id="project-publish-hint">
            Unpublished projects stay hidden from visitors.
          </span>
        </span>
      </label>
      <details className="border border-border p-4">
        <summary className="min-h-10 cursor-pointer content-center">
          Advanced details
        </summary>
        <div className="mt-4 grid gap-4">
          <label>
            Category
            <select
              aria-describedby="project-category-hint"
              className={inputClass}
              name="categoryId"
              defaultValue={project?.categoryId ?? ""}
            >
              {project ? null : <option value="">Automatic</option>}
              {categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className={hintClass} id="project-category-hint">
              {project
                ? "Groups the project on the Work page."
                : "Automatic uses the first active category in the Categories list."}
            </span>
          </label>
          <label>
            Slug
            <input
              aria-describedby="project-slug-hint"
              className={inputClass}
              name="slug"
              defaultValue={project?.slug ?? ""}
              placeholder={project ? undefined : "Generated from the title"}
            />
            <span className={hintClass} id="project-slug-hint">
              {project
                ? "The project's web address. Changing it breaks links already shared."
                : "Leave empty to create it from the title."}
            </span>
          </label>
          <label>
            Full description
            <textarea
              className="min-h-56 w-full border border-border bg-background p-3"
              name="description"
              defaultValue={project?.description ?? ""}
            />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label>
              Client
              <input
                className={inputClass}
                name="clientName"
                defaultValue={project?.clientName ?? ""}
              />
            </label>
            <label>
              Location
              <input
                className={inputClass}
                name="location"
                defaultValue={project?.location ?? ""}
              />
            </label>
            <label>
              Project date
              <input
                className={inputClass}
                type="date"
                name="projectDate"
                defaultValue={
                  project?.projectDate?.toISOString().slice(0, 10) ?? ""
                }
              />
            </label>
            <label>
              Order
              <input
                className={inputClass}
                type="number"
                name="sortOrder"
                defaultValue={project?.sortOrder ?? 0}
              />
            </label>
          </div>
          <label className="flex min-h-10 items-center gap-3">
            <input
              className="size-5"
              type="checkbox"
              name="featured"
              defaultChecked={project?.featured}
            />
            Featured
          </label>
          <label>
            SEO title
            <input
              className={inputClass}
              name="seoTitle"
              defaultValue={project?.seoTitle ?? ""}
            />
          </label>
          <label>
            SEO description
            <textarea
              className={areaClass}
              name="seoDescription"
              defaultValue={project?.seoDescription ?? ""}
            />
          </label>
        </div>
      </details>
      <div>
        <button className={buttonClass}>Save project</button>
      </div>
    </AdminForm>
  );
}
