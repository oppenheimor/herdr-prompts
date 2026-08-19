import React, { useReducer } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import { type AgentTarget, type HerdrClient } from "./herdr.js";
import {
  createPickerState,
  currentPrompt,
  nextGraphemeBoundary,
  pickerReducer,
  type PickerMode,
  visiblePrompts,
} from "./picker-state.js";
import { isBackwardDeletionKey } from "./input.js";
import type { Prompt, PromptStore } from "./store.js";
import { findTemplateVariables, materializePrompt } from "./template.js";

export interface PickerAppProps {
  initialPrompts: Prompt[];
  store: PromptStore;
  herdr: HerdrClient;
  target: AgentTarget;
}

export function PickerApp({
  initialPrompts,
  store,
  herdr,
  target,
}: PickerAppProps): React.JSX.Element {
  const [state, dispatch] = useReducer(
    pickerReducer,
    initialPrompts,
    createPickerState,
  );
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = stdout.columns ?? 100;
  const rows = stdout.rows ?? 30;

  useInput((input, key) => {
    if (state.mode === "delete-confirm") {
      if (key.escape || key.return || input.toLowerCase() === "n") {
        dispatch({ type: "cancel" });
      } else if (input.toLowerCase() === "y") {
        const prompt = currentPrompt(state);
        if (!prompt) return;
        try {
          dispatch({ type: "replace-prompts", prompts: store.remove(prompt.content) });
        } catch (error) {
          dispatch({ type: "set-error", error: errorMessage(error) });
        }
      }
      return;
    }

    if (state.mode !== "list") {
      if (key.escape) {
        if (state.mode === "create" && state.prompts.length === 0) {
          exit();
        } else {
          dispatch({ type: "cancel" });
        }
        return;
      }
      if (key.ctrl && input.toLowerCase() === "s") {
        applyEditor(state, store, herdr, target, dispatch, exit);
        return;
      }
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        dispatch({
          type: "move-cursor",
          direction: key.upArrow
            ? "up"
            : key.downArrow
              ? "down"
              : key.leftArrow
                ? "left"
                : "right",
        });
        return;
      }
      if (isBackwardDeletionKey(key)) {
        dispatch({ type: "backspace" });
        return;
      }
      if (key.return) {
        dispatch({ type: "insert-text", text: "\n" });
        return;
      }
      if (key.tab) {
        dispatch({ type: "insert-text", text: "\t" });
        return;
      }
      if (input.length > 0 && !key.ctrl && !key.meta && !key.super) {
        dispatch({ type: "insert-text", text: input });
      }
      return;
    }

    if (key.escape) {
      exit();
    } else if (key.upArrow) {
      dispatch({ type: "move", delta: -1 });
    } else if (key.downArrow) {
      dispatch({ type: "move", delta: 1 });
    } else if (isBackwardDeletionKey(key)) {
      dispatch({ type: "set-query", query: state.query.slice(0, -1) });
    } else if (key.ctrl && input.toLowerCase() === "n") {
      dispatch({ type: "start-create" });
    } else if (key.ctrl && input.toLowerCase() === "e") {
      dispatch({ type: "start-edit" });
    } else if (key.ctrl && input.toLowerCase() === "d") {
      dispatch({ type: "start-delete" });
    } else if (key.return) {
      const prompt = currentPrompt(state);
      if (!prompt) return;
      if (findTemplateVariables(prompt.content).length > 0) {
        dispatch({ type: "start-fill" });
        return;
      }
      try {
        herdr.insertPrompt(target, materializePrompt(prompt.content));
        exit();
      } catch (error) {
        dispatch({ type: "set-error", error: errorMessage(error) });
      }
    } else if (input.length > 0 && !key.ctrl && !key.meta && !key.super) {
      dispatch({ type: "set-query", query: state.query + input });
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          Herdr Prompts
        </Text>
        <Text dimColor>{state.prompts.length} saved</Text>
      </Box>
      {state.mode === "list" || state.mode === "delete-confirm" ? (
        <ListView state={state} columns={columns} rows={rows} />
      ) : (
        <EditorView state={state} />
      )}
      {state.error ? <Text color="red">{state.error}</Text> : null}
      <Footer mode={state.mode} />
    </Box>
  );
}

export function FatalApp({ message }: { message: string }): React.JSX.Element {
  const { exit } = useApp();
  useInput((_input, key) => {
    if (key.escape || key.return) exit();
  });
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={1}>
      <Text bold color="red">
        Herdr Prompts could not start
      </Text>
      <Text>{message}</Text>
      <Text dimColor>Esc/Enter close</Text>
    </Box>
  );
}

function ListView({
  state,
  columns,
  rows,
}: {
  state: ReturnType<typeof createPickerState>;
  columns: number;
  rows: number;
}): React.JSX.Element {
  const prompts = visiblePrompts(state);
  const selected = currentPrompt(state);
  const narrow = columns < 80;
  const maxRows = Math.max(3, Math.min(14, rows - 9));
  const windowStart = Math.max(
    0,
    Math.min(state.selectedIndex - Math.floor(maxRows / 2), prompts.length - maxRows),
  );
  const shown = prompts.slice(windowStart, windowStart + maxRows);

  return (
    <>
      <Box marginTop={1}>
        <Text color="cyan">Search: </Text>
        <Text>{state.query}</Text>
        <Text inverse> </Text>
      </Box>
      <Box flexDirection={narrow ? "column" : "row"} gap={1}>
        <Box
          width={narrow ? "100%" : "40%"}
          minHeight={Math.min(maxRows + 2, 10)}
          flexDirection="column"
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          {shown.length === 0 ? (
            <Text dimColor>No matching prompts</Text>
          ) : (
            shown.map((prompt, index) => {
              const absoluteIndex = windowStart + index;
              const active = absoluteIndex === state.selectedIndex;
              return (
                <Text
                  key={`${absoluteIndex}:${prompt.content}`}
                  {...(active ? { color: "cyan" as const, bold: true } : {})}
                >
                  {active ? "› " : "  "}
                  {truncate(summary(prompt.content), narrow ? columns - 8 : Math.floor(columns * 0.36))}
                </Text>
              );
            })
          )}
        </Box>
        <Box
          width={narrow ? "100%" : "60%"}
          minHeight={narrow ? 5 : Math.min(maxRows + 2, 10)}
          borderStyle="round"
          borderColor="gray"
          paddingX={1}
        >
          <Text wrap="wrap">{selected?.content ?? "No prompt selected"}</Text>
        </Box>
      </Box>
      {state.mode === "delete-confirm" && selected ? (
        <Box borderStyle="round" borderColor="yellow" paddingX={1}>
          <Text color="yellow">Delete this prompt? y/N</Text>
        </Box>
      ) : null}
    </>
  );
}

function EditorView({
  state,
}: {
  state: ReturnType<typeof createPickerState>;
}): React.JSX.Element {
  const variables = findTemplateVariables(state.draft);
  const title =
    state.mode === "create"
      ? "New prompt"
      : state.mode === "edit"
        ? "Edit prompt"
        : "Fill template";

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">
        {title}
      </Text>
      <Box borderStyle="round" borderColor="gray" paddingX={1} minHeight={8}>
        <EditorText text={state.draft} cursor={state.cursor} />
      </Box>
      {state.mode === "fill" && variables.length > 0 ? (
        <Text color="yellow">Replace: {variables.join(", ")}</Text>
      ) : null}
    </Box>
  );
}

function EditorText({ text, cursor }: { text: string; cursor: number }): React.JSX.Element {
  const before = text.slice(0, cursor);
  const nextCursor = nextGraphemeBoundary(text, cursor);
  const current = text.slice(cursor, nextCursor);
  const after = text.slice(nextCursor);
  return (
    <Text wrap="wrap">
      {before}
      <Text inverse>{current.length === 0 ? " " : current === "\n" ? "↵" : current}</Text>
      {current === "\n" ? "\n" : null}
      {after}
    </Text>
  );
}

function Footer({ mode }: { mode: PickerMode }): React.JSX.Element {
  const help =
    mode === "list"
      ? "Type search  ↑↓ select  Enter insert  ^N new  ^E edit  ^D delete  Esc close"
      : mode === "delete-confirm"
        ? "y delete  n/Esc cancel"
        : mode === "fill"
          ? "Enter newline  ^S fill prompt  Esc cancel"
          : "Enter newline  ^S save  Esc cancel";
  return <Text dimColor>{help}</Text>;
}

function applyEditor(
  state: ReturnType<typeof createPickerState>,
  store: PromptStore,
  herdr: HerdrClient,
  target: AgentTarget,
  dispatch: React.Dispatch<Parameters<typeof pickerReducer>[1]>,
  exit: (error?: Error) => void,
): void {
  try {
    if (state.mode === "create") {
      dispatch({ type: "replace-prompts", prompts: store.add(state.draft) });
    } else if (state.mode === "edit") {
      if (!state.originalContent) throw new Error("Original prompt is missing");
      dispatch({
        type: "replace-prompts",
        prompts: store.update(state.originalContent, state.draft),
      });
    } else if (state.mode === "fill") {
      const unresolved = findTemplateVariables(state.draft);
      if (unresolved.length > 0) {
        dispatch({
          type: "set-error",
          error: `Replace unresolved variables: ${unresolved.join(", ")}`,
        });
        return;
      }
      herdr.insertPrompt(target, materializePrompt(state.draft));
      exit();
    }
  } catch (error) {
    dispatch({ type: "set-error", error: errorMessage(error) });
  }
}

function summary(content: string): string {
  return content.split("\n").find((line) => line.trim().length > 0)?.trim() ?? "(blank)";
}

function truncate(content: string, maxLength: number): string {
  const safeLength = Math.max(8, maxLength);
  return content.length <= safeLength
    ? content
    : `${content.slice(0, safeLength - 1)}…`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
