import { useEffect, useMemo, useState } from "react";

import {
  LiveMessage,
  fetchModules,
  fetchNodes,
  openMessageFeed,
  publishNode,
  validateNode,
} from "./api";
import { knownOutputTopics } from "./topics";
import {
  ConfigError,
  ConfigFile,
  ModuleSchemasByKind,
  NodesResponse,
} from "./types";
import CommitReviewModal from "./components/CommitReviewModal";
import ConnectionsPanel from "./components/ConnectionsPanel";
import MessageFeed from "./components/MessageFeed";
import Minimap from "./components/Minimap";
import NodeList from "./components/NodeList";
import TaskList from "./components/TaskList";
import ValidationPanel from "./components/ValidationPanel";

const MESSAGE_BUFFER_SIZE = 500;
const VALIDATE_DEBOUNCE_MS = 400;

interface PublishState {
  status: "idle" | "publishing" | "success" | "error";
  message?: string;
}

export default function App() {
  const [nodes, setNodes] = useState<NodesResponse | null>(null);
  const [modules, setModules] = useState<ModuleSchemasByKind | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConfigFile | null>(null);
  const [structureRevision, setStructureRevision] = useState(0);
  const [errors, setErrors] = useState<Array<ConfigError>>([]);
  const [publishState, setPublishState] = useState<PublishState>({
    status: "idle",
  });
  const [showReview, setShowReview] = useState(false);

  const [collapsedTasks, setCollapsedTasks] = useState<Record<string, boolean>>(
    {},
  );
  const [pendingScrollTo, setPendingScrollTo] = useState<string | null>(null);

  const [messages, setMessages] = useState<Array<LiveMessage>>([]);

  useEffect(() => {
    let active = true;

    Promise.all([fetchNodes(), fetchModules()])
      .then(([nodesResult, modulesResult]) => {
        if (!active) return;
        setNodes(nodesResult);
        setModules(modulesResult);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(String(error));
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return openMessageFeed((message) => {
      setMessages((prev) => [...prev, message].slice(-MESSAGE_BUFFER_SIZE));
    });
  }, []);

  const isDirty = useMemo(() => {
    if (!selectedNode || !draft || !nodes) return false;
    return JSON.stringify(draft) !== JSON.stringify(nodes[selectedNode]);
  }, [selectedNode, draft, nodes]);

  useEffect(() => {
    if (!selectedNode || !draft) {
      setErrors([]);
      return;
    }

    const timer = setTimeout(() => {
      validateNode(selectedNode, draft)
        .then(setErrors)
        .catch(() => {});
    }, VALIDATE_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [selectedNode, draft]);

  function confirmDiscardIfDirty(): boolean {
    if (!selectedNode || !isDirty) return true;

    return window.confirm(
      `Discard unpublished changes to "${selectedNode}"? This cannot be undone.`,
    );
  }

  // Clicking the already-selected node, or the "cutie" title, both return to
  // the unselected view -- the node list plus the always-visible validation
  // and live-message rail, with no single node's editor in the way.
  function selectNode(name: string) {
    if (name === selectedNode) return goHome();
    if (!confirmDiscardIfDirty()) return;

    setSelectedNode(name);
    setDraft(nodes ? structuredClone(nodes[name]) : null);
    setStructureRevision(0);
    setPublishState({ status: "idle" });
    setCollapsedTasks({});
  }

  function goHome() {
    if (!confirmDiscardIfDirty()) return;

    setSelectedNode(null);
    setDraft(null);
    setStructureRevision(0);
    setPublishState({ status: "idle" });
    setCollapsedTasks({});
  }

  function toggleTaskCollapse(name: string) {
    setCollapsedTasks((prev) => ({ ...prev, [name]: !prev[name] }));
  }

  function jumpToTask(taskName: string) {
    document
      .getElementById(`tasks.${taskName}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function jumpToStep(taskName: string, stepId: string) {
    if (collapsedTasks[taskName]) {
      setCollapsedTasks((prev) => ({ ...prev, [taskName]: false }));
      setPendingScrollTo(stepId);
    } else {
      document
        .getElementById(stepId)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  useEffect(() => {
    if (!pendingScrollTo) return;
    const id = pendingScrollTo;
    setPendingScrollTo(null);
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [pendingScrollTo]);

  function mutate(fn: (clone: ConfigFile) => void, structural = false) {
    setDraft((prev) => {
      if (!prev) return prev;
      const clone = structuredClone(prev);
      fn(clone);
      return clone;
    });

    if (structural) setStructureRevision((revision) => revision + 1);
  }

  function openPublishReview() {
    if (!selectedNode || !draft) return;
    setShowReview(true);
  }

  async function confirmPublish() {
    if (!selectedNode || !draft) return;

    setPublishState({ status: "publishing" });

    const result = await publishNode(selectedNode, draft);

    if (result.ok) {
      setNodes((prev) => (prev ? { ...prev, [selectedNode]: draft } : prev));
      setErrors(result.warnings ?? []);
      setPublishState({
        status: "success",
        message: result.warnings?.length
          ? `Published with ${result.warnings.length} warning(s).`
          : "Published.",
      });
    } else {
      setErrors(result.errors ?? []);
      setPublishState({
        status: "error",
        message: `Refused to publish: ${result.errors?.length ?? 0} error(s), shown below.`,
      });
    }
  }

  const nodeTopics = useMemo(
    () => (draft ? knownOutputTopics(draft) : []),
    [draft],
  );

  if (loadError)
    return (
      <div className="empty-state">
        Could not reach the cutie web UI backend: {loadError}
      </div>
    );

  return (
    <div className="app">
      <header className="app-header">
        <h1 onClick={goHome} title="Back to all nodes">
          cutie
        </h1>
        {selectedNode && <span>{selectedNode}</span>}
        <div className="spacer" />
        {publishState.message && (
          <span className={`status-line ${publishState.status}`}>
            {publishState.message}
          </span>
        )}
        <button
          className="primary"
          disabled={
            !selectedNode ||
            !isDirty ||
            publishState.status === "publishing" ||
            errors.some((error) => error.severity === "error")
          }
          onClick={openPublishReview}
        >
          Review & Publish
        </button>
      </header>

      <div className="sidebar">
        <NodeList
          nodeNames={nodes ? Object.keys(nodes).sort() : []}
          selected={selectedNode}
          isDirty={isDirty}
          onSelect={selectNode}
        />
      </div>

      <div className="main">
        {!selectedNode || !draft || !modules ? (
          <div className="empty-state">
            {nodes === null
              ? "Loading..."
              : "Select a node from the list to edit its config."}
          </div>
        ) : (
          <>
            <ConnectionsPanel
              config={draft}
              modules={modules}
              errors={errors}
              structureRevision={structureRevision}
              mutate={mutate}
            />
            <TaskList
              config={draft}
              modules={modules}
              errors={errors}
              structureRevision={structureRevision}
              mutate={mutate}
              collapsedTasks={collapsedTasks}
              onToggleTaskCollapse={toggleTaskCollapse}
            />
          </>
        )}
      </div>

      <div className="rail">
        <div className="rail-section">
          <h2>Validation</h2>
          <ValidationPanel errors={errors} />
        </div>
        <div className="rail-section grow">
          <MessageFeed messages={messages} nodeTopics={nodeTopics} />
        </div>
      </div>

      <Minimap
        config={draft}
        collapsedTasks={collapsedTasks}
        onJumpToTask={jumpToTask}
        onJumpToStep={jumpToStep}
      />

      {showReview && selectedNode && draft && nodes && (
        <CommitReviewModal
          nodeName={selectedNode}
          before={nodes[selectedNode]}
          after={draft}
          publishing={publishState.status === "publishing"}
          onCancel={() => setShowReview(false)}
          onConfirm={async () => {
            await confirmPublish();
            setShowReview(false);
          }}
        />
      )}
    </div>
  );
}
