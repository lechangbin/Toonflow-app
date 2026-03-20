import express from "express";
import u from "@/utils";
import {
  EventType,
  RunStartedEvent,
  RunFinishedEvent,
  RunErrorEvent,
  StepStartedEvent,
  StepFinishedEvent,
  TextMessageStartEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  StateSnapshotEvent,
  StateDeltaEvent,
  MessagesSnapshotEvent,
  ActivitySnapshotEvent,
  ActivityDeltaEvent,
  ReasoningStartEvent,
  ReasoningMessageStartEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningEndEvent,
  ReasoningEncryptedValueEvent,
  RawEvent,
  CustomEvent,
  Message,
} from "@ag-ui/core";

type Role = "developer" | "system" | "assistant" | "user";

/**
 * AG-UI SSE 事件流构建器
 * 封装所有 AG-UI 协议事件的发送逻辑
 */
export class AGUIStream {
  private res: express.Response;
  private runId: string;
  private threadId: string;

  constructor(res: express.Response, threadId?: string) {
    this.res = res;
    this.runId = u.uuid();
    this.threadId = threadId ?? u.uuid();

    // 设置 SSE 响应头
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
  }

  // ==================== 基础发送 ====================

  private send(data: Record<string, unknown>) {
    this.res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // ==================== Run 生命周期 ====================

  runStarted() {
    this.send({
      type: EventType.RUN_STARTED,
      threadId: this.threadId,
      runId: this.runId,
    } satisfies RunStartedEvent);
    return this;
  }

  runFinished() {
    this.send({
      type: EventType.RUN_FINISHED,
      threadId: this.threadId,
      runId: this.runId,
    } satisfies RunFinishedEvent);
    return this;
  }

  runError(message: string, code?: string) {
    this.send({
      type: EventType.RUN_ERROR,
      message,
      ...(code && { code }),
    } satisfies RunErrorEvent);
    return this;
  }

  // ==================== 文本消息 ====================

  textMessage(role: Role = "assistant") {
    const messageId = u.uuid();

    this.send({
      type: EventType.TEXT_MESSAGE_START,
      messageId,
      role,
    } satisfies TextMessageStartEvent);

    const handle = {
      send: (delta: string) => {
        this.send({
          type: EventType.TEXT_MESSAGE_CONTENT,
          messageId,
          delta,
        } satisfies TextMessageContentEvent);
        return handle;
      },
      end: () => {
        this.send({
          type: EventType.TEXT_MESSAGE_END,
          messageId,
        } satisfies TextMessageEndEvent);
      },
    };
    return handle;
  }

  /** 一次性发送完整文本消息 */
  textMessageFull(content: string, role: Role = "assistant") {
    const msg = this.textMessage(role);
    msg.send(content);
    msg.end();
    return this;
  }

  // ==================== 工具调用 ====================

  toolCall(toolCallName: string, parentMessageId?: string) {
    const toolCallId = u.uuid();

    this.send({
      type: EventType.TOOL_CALL_START,
      toolCallId,
      toolCallName,
      ...(parentMessageId && { parentMessageId }),
    } satisfies ToolCallStartEvent);

    return {
      args: (delta: string) => {
        this.send({
          type: EventType.TOOL_CALL_ARGS,
          toolCallId,
          delta,
        } satisfies ToolCallArgsEvent);
      },
      end: () => {
        this.send({
          type: EventType.TOOL_CALL_END,
          toolCallId,
        } satisfies ToolCallEndEvent);
      },
      /** 发送工具调用结果 */
      result: (content: string) => {
        const messageId = u.uuid();
        this.send({
          type: EventType.TOOL_CALL_RESULT,
          messageId,
          toolCallId,
          role: "tool",
          content,
        } satisfies ToolCallResultEvent);
      },
    };
  }

  // ==================== 状态管理 ====================

  stateSnapshot(snapshot: unknown) {
    this.send({
      type: EventType.STATE_SNAPSHOT,
      snapshot,
    } satisfies StateSnapshotEvent);
    return this;
  }

  stateDelta(delta: unknown[]) {
    this.send({
      type: EventType.STATE_DELTA,
      delta,
    } satisfies StateDeltaEvent);
    return this;
  }

  // ==================== 消息快照 ====================

  messagesSnapshot(messages: Message[]) {
    this.send({
      type: EventType.MESSAGES_SNAPSHOT,
      messages,
    } satisfies MessagesSnapshotEvent);
    return this;
  }

  // ==================== Activity 事件 ====================

  activitySnapshot(
    messageId: string,
    activityType: string,
    content: Record<string, unknown>,
    replace = true,
  ) {
    this.send({
      type: EventType.ACTIVITY_SNAPSHOT,
      messageId,
      activityType,
      content,
      replace,
    } satisfies ActivitySnapshotEvent);
    return this;
  }

  activityDelta(
    messageId: string,
    activityType: string,
    patch: unknown[],
  ) {
    this.send({
      type: EventType.ACTIVITY_DELTA,
      messageId,
      activityType,
      patch,
    } satisfies ActivityDeltaEvent);
    return this;
  }

  // ==================== Reasoning 事件 ====================

  reasoning() {
    const messageId = u.uuid();

    this.send({
      type: EventType.REASONING_START,
      messageId,
    } satisfies ReasoningStartEvent);

    return {
      messageStart: () => {
        this.send({
          type: EventType.REASONING_MESSAGE_START,
          messageId,
          role: "reasoning",
        } satisfies ReasoningMessageStartEvent);
      },
      content: (delta: string) => {
        this.send({
          type: EventType.REASONING_MESSAGE_CONTENT,
          messageId,
          delta,
        } satisfies ReasoningMessageContentEvent);
      },
      messageEnd: () => {
        this.send({
          type: EventType.REASONING_MESSAGE_END,
          messageId,
        } satisfies ReasoningMessageEndEvent);
      },
      end: () => {
        this.send({
          type: EventType.REASONING_END,
          messageId,
        } satisfies ReasoningEndEvent);
      },
      encryptedValue: (
        subtype: "tool-call" | "message",
        entityId: string,
        encryptedValue: string,
      ) => {
        this.send({
          type: EventType.REASONING_ENCRYPTED_VALUE,
          subtype,
          entityId,
          encryptedValue,
        } satisfies ReasoningEncryptedValueEvent);
      },
    };
  }

  // ==================== Raw / Custom 事件 ====================

  raw(event: unknown, source?: string) {
    this.send({
      type: EventType.RAW,
      event,
      ...(source && { source }),
    } satisfies RawEvent);
    return this;
  }

  custom(name: string, value: unknown) {
    this.send({
      type: EventType.CUSTOM,
      name,
      value,
    } satisfies CustomEvent);
    return this;
  }

  // ==================== 结束 ====================

  end() {
    this.res.end();
  }

  getRunId() {
    return this.runId;
  }

  getThreadId() {
    return this.threadId;
  }
}

/** 创建 AG-UI 事件流 */
export function createAGUIStream(res: express.Response): AGUIStream {
  return new AGUIStream(res);
}