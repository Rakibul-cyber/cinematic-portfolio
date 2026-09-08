import { NotFoundContent } from "@/components/public/not-found-content";

/** 404 for public routes; the route-group layout supplies header and footer. */
export default function PublicNotFound() {
  return <NotFoundContent />;
}
