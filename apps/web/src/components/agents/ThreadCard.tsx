import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { useState, useRef, type CSSProperties } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { PreviewCard, PreviewCardTrigger, PreviewCardPopup } from "../ui/preview-card";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { useProject } from "../../state/entities";
import type { McpGatewayProfile, EnvironmentId, ThreadLinkedPullRequest } from "@t3tools/contracts";
import { AgentIcon } from "./AgentIcon";
import { useEnvironment } from "../../state/environments";
import {
  useLinkedThreadPullRequest,
  ChangeRequestStatusIcon,
  prStatusIndicator,
} from "../ThreadStatusIndicators";
import { AgentChatPreview } from "./AgentChatPreview";
import { ThreadSpeedControl } from "./ThreadSpeedControl";
import { agentThreadStatus, agentThreadStatusLabel } from "./agents.logic";

export function ThreadCard({
  thread,
  profile,
  onContextMenu,
}: {
  profile?: McpGatewayProfile | undefined;
  thread: EnvironmentThreadShell;
  onContextMenu: (
    thread: EnvironmentThreadShell,
    position: { x: number; y: number },
  ) => Promise<void>;
}) {
  const pathname = useLocation({ select: (location) => location.pathname });
  const environment = useEnvironment(thread.environmentId);
  const prs = [thread.linkedPullRequest, thread.branchPullRequest].filter(
    (pr, index, items) => pr != null && items.findIndex((item) => item?.url === pr.url) === index,
  );
  const project = useProject(scopeProjectRef(thread.environmentId, thread.projectId));
  const [previewOpen, setPreviewOpen] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const status = agentThreadStatus(thread);
  const popupRef = useRef<HTMLDivElement>(null);
  return (
    <div
      className="agent-thread-container"
      data-current={pathname === `/agents/${thread.environmentId}/${thread.id}`}
      style={{ "--agent-color": profile?.color ?? "var(--muted-foreground)" } as CSSProperties}
    >
      <PreviewCard
        open={!contextMenuOpen && previewOpen}
        onOpenChange={(open, details) => {
          if (
            !open &&
            details.reason === "trigger-hover" &&
            popupRef.current?.contains(document.activeElement)
          )
            return;
          setPreviewOpen(open);
        }}
      >
        <PreviewCardTrigger
          onContextMenu={(event) => {
            event.preventDefault();
            setPreviewOpen(false);
            setContextMenuOpen(true);
            void onContextMenu(thread, { x: event.clientX, y: event.clientY }).finally(() => {
              setPreviewOpen(false);
              setContextMenuOpen(false);
            });
          }}
          delay={400}
          render={
            <Link
              to="/agents/$environmentId/$threadId"
              params={{ environmentId: thread.environmentId, threadId: thread.id }}
            />
          }
          className={`agent-thread agent-thread-${status}`}
        >
          <div className="agent-thread-title">
            <strong>{thread.title}</strong>
            <div className="agent-thread-identity">
              {thread.profileSnapshot && (
                <span>
                  <AgentIcon icon={profile?.icon} />
                  <span>
                    {profile?.name ?? thread.profileSnapshot.profileName ?? "Removed agent"}
                  </span>
                </span>
              )}
              <span className={`agent-status agent-status-${status}`}>
                {agentThreadStatusLabel(status)}
              </span>
            </div>
          </div>
          <div className="agent-thread-meta">
            <div className="agent-thread-location">
              <span className="agent-thread-project">
                {project?.title ?? "Project unavailable"}
              </span>
            </div>
          </div>
          {environment?.connection.phase !== "connected" && (
            <p className="agent-thread-time">Environment unavailable</p>
          )}
          <time className="agent-thread-time" dateTime={thread.updatedAt}>
            {new Date(thread.updatedAt).toLocaleString(undefined, {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </PreviewCardTrigger>
        <PreviewCardPopup
          ref={popupRef}
          side="right"
          align="start"
          sideOffset={12}
          className="agent-chat-preview bg-background text-foreground"
        >
          {previewOpen && (
            <AgentChatPreview thread={thread} project={project?.title ?? "Project unavailable"} />
          )}
        </PreviewCardPopup>
      </PreviewCard>
      {prs.length > 0 && (
        <div className="agent-thread-prs">
          {prs.map(
            (pr) =>
              pr && <AgentThreadPr key={pr.url} environmentId={thread.environmentId} pr={pr} />,
          )}
        </div>
      )}
      <ThreadSpeedControl thread={thread} />
    </div>
  );
}

function AgentThreadPr({
  environmentId,
  pr,
}: {
  environmentId: EnvironmentId;
  pr: ThreadLinkedPullRequest;
}) {
  const linked = useLinkedThreadPullRequest(environmentId, pr);
  const status = prStatusIndicator(linked?.pr ?? null, linked?.sourceControlProvider);
  return (
    <Tooltip>
      <TooltipTrigger
        render={<a href={pr.url} target="_blank" rel="noreferrer" className={status?.colorClass} />}
      >
        <ChangeRequestStatusIcon
          state={linked?.pr.state ?? "open"}
          isDraft={linked?.pr.isDraft}
          className="size-3 shrink-0"
        />
        <span>
          {pr.repository} #{pr.number}
        </span>
        {status && <span>{status.label}</span>}
      </TooltipTrigger>
      <TooltipPopup>{status?.tooltip ?? pr.url}</TooltipPopup>
    </Tooltip>
  );
}
