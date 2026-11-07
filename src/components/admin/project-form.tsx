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
  return (
    <AdminForm action={saveProjectAction} className="grid gap-4">
      {project && <input type="hidden" name="id" value={project.id} />}
      {project && (
        <input
          type="hidden"
          name="expectedUpdatedAt"
          value={project.updatedAt.toISOString()}
        />
      )}
      <label>
        Title
        <input
          className={inputClass}
          name="title"
          defaultValue={project?.title}
          required
        />
      </label>
      <label>
        Slug
        <input
          className={inputClass}
          name="slug"
          defaultValue={project?.slug}
          required
        />
      </label>
      <label>
        Category
        <select
          className={inputClass}
          name="categoryId"
          defaultValue={project?.categoryId}
          required
        >
          <option value="">Select category</option>
          {categories.map((c) => (
            <option value={c.id} key={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Summary
        <textarea
          className={areaClass}
          name="summary"
          defaultValue={project?.summary}
          required
        />
      </label>
      <label>
        Description
        <textarea
          className="min-h-56 w-full border border-border bg-background p-3"
          name="description"
          defaultValue={project?.description}
          required
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
        <label>
          Status
          <select
            className={inputClass}
            name="status"
            defaultValue={project?.status ?? "DRAFT"}
          >
            <option>DRAFT</option>
            <option>PUBLISHED</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            name="featured"
            defaultChecked={project?.featured}
          />{" "}
          Featured
        </label>
      </div>
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
      <ProjectVideoField
        initialTitle={storedVideo?.title ?? ""}
        initialUrl={storedVideo ? videoSourceUrl(storedVideo) ?? "" : ""}
      />
      <ProjectMediaPicker
        initialMediaIds={selectedMediaIds}
        media={media}
      />
      <button className={buttonClass}>Save project</button>
    </AdminForm>
  );
}
