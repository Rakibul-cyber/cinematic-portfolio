import { toCsv } from "@/lib/crm/csv"; import { AuthorizationError, requireAdmin } from "@/server/auth/session"; import { recordAuditLog } from "@/server/audit/audit-log"; import { prisma } from "@/server/db/prisma";
export async function GET() {
  let actor;
  try {
    actor = await requireAdmin("/admin/inquiries");
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return new Response("Forbidden", { status: 403, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store" } });
    }
    throw error;
  }
  const data=await prisma.inquiry.findMany({orderBy:[{createdAt:"desc"},{id:"desc"}]}); const rows=[ ["receivedAt","status","name","email","phone","whatsapp","company","projectType","projectDate","location","budget","service","referralSource","message"], ...data.map(i=>[i.createdAt.toISOString(),i.status,i.nameSnapshot,i.emailSnapshot,i.phoneSnapshot,i.whatsappSnapshot,i.companySnapshot,i.projectType,i.projectDate?.toISOString().slice(0,10),i.location,i.budgetLabel,i.serviceNameSnapshot,i.referralSource,i.message]) ]; await recordAuditLog({action:"crm.exported",entityType:"inquiry",actorUserId:actor.id,actorEmail:actor.email,metadata:{rowCount:data.length}}); return new Response(toCsv(rows),{headers:{"content-type":"text/csv; charset=utf-8","content-disposition":`attachment; filename="inquiries-${new Date().toISOString().slice(0,10)}.csv"`,"cache-control":"private, no-store"}}); }
