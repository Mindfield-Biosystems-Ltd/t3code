import {
  connectGatewayBridge,
  connectManagedGatewayRelays,
  createGatewayRuntimeEventSourceFromContext,
  createGatewayRuntimePortFromContext,
} from "@t3tools/client-runtime/gateway";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useMemo, useState } from "react";

import type { AppRouter } from "./router";
import { openDesktopGatewayThread, openDesktopGatewayAgents } from "./mcpGatewayNavigation";
import { connectionAtomRuntime } from "./connection/runtime";
import {
  getMcpGatewayGrants,
  getMcpGatewayPort,
  getMcpGatewayToken,
  isMcpGatewayEnabled,
  publishMcpGatewayStatus,
  publishMcpGatewayStatusSnapshot,
  setMcpGatewayStatusRequester,
  subscribeMcpGatewayConfiguration,
} from "./mcpGatewayState";
import { appAtomRegistry } from "./rpc/atomRegistry";

export function McpGatewayHost({ router }: { readonly router: AppRouter }) {
  const [configuration, setConfiguration] = useState(() => ({
    available: (window.desktopBridge?.getMcpGatewayLaunchConfig?.() ?? null) !== null,
    enabled: isMcpGatewayEnabled(),
    port: getMcpGatewayPort(),
    grants: getMcpGatewayGrants(),
    token: getMcpGatewayToken(),
  }));

  useEffect(() => {
    const onChange = () =>
      setConfiguration({
        available: (window.desktopBridge?.getMcpGatewayLaunchConfig?.() ?? null) !== null,
        enabled: isMcpGatewayEnabled(),
        port: getMcpGatewayPort(),
        grants: getMcpGatewayGrants(),
        token: getMcpGatewayToken(),
      });
    return subscribeMcpGatewayConfiguration(onChange);
  }, []);

  const nativeConfiguration = useMemo(
    () => ({
      enabled: configuration.available && configuration.enabled && configuration.token.length >= 16,
      token: configuration.token,
      port: configuration.port,
    }),
    [configuration.available, configuration.enabled, configuration.token, configuration.port],
  );
  const [readyConfiguration, setReadyConfiguration] = useState<typeof nativeConfiguration | null>(
    null,
  );
  const managedReady = nativeConfiguration.enabled && readyConfiguration === nativeConfiguration;
  useEffect(() => {
    let stopped = false;
    const desktop = window.desktopBridge;
    if (!desktop?.configureManagedMcpGateway) return;
    void desktop
      .configureManagedMcpGateway(
        nativeConfiguration.enabled
          ? { token: nativeConfiguration.token, port: nativeConfiguration.port }
          : null,
      )
      .then(
        () => {
          if (!stopped) setReadyConfiguration(nativeConfiguration);
        },
        (error) => {
          if (!stopped) {
            console.error("MCP gateway startup failed", error);
            publishMcpGatewayStatus("degraded");
          }
        },
      );
    return () => {
      stopped = true;
      void desktop
        .configureManagedMcpGateway?.(null)
        .catch((error) => console.error("MCP gateway shutdown failed", error));
    };
  }, [nativeConfiguration]);

  useEffect(() => {
    if (
      !configuration.available ||
      !configuration.enabled ||
      configuration.token.length < 16 ||
      !managedReady
    ) {
      publishMcpGatewayStatus(configuration.enabled ? "degraded" : "disabled");
      publishMcpGatewayStatusSnapshot(null);
      setMcpGatewayStatusRequester(null);
      return;
    }

    const unmountRuntime = appAtomRegistry.mount(connectionAtomRuntime);
    let bridge: ReturnType<typeof connectGatewayBridge> | null = null;
    let unsubscribe: (() => void) | null = null;
    let stopped = false;
    let stopRelays: (() => void) | undefined;
    const startWhenReady = () => {
      if (stopped || bridge !== null) return;
      const value = AsyncResult.value(appAtomRegistry.get(connectionAtomRuntime));
      if (Option.isNone(value)) return;
      bridge = connectGatewayBridge({
        port: createGatewayRuntimePortFromContext(
          value.value,
          (environmentId, threadId) =>
            openDesktopGatewayThread(router, window.desktopBridge, environmentId, threadId),
          () => openDesktopGatewayAgents(router, window.desktopBridge),
        ),
        events: createGatewayRuntimeEventSourceFromContext(value.value),
        grants: configuration.grants,
        token: configuration.token,
        url: `ws://127.0.0.1:${configuration.port}`,
        onState: (state) => {
          publishMcpGatewayStatus(state);
          if (state === "running" && !stopRelays && window.desktopBridge) {
            stopRelays = connectManagedGatewayRelays(
              value.value,
              window.desktopBridge,
              Object.keys(configuration.grants),
              (error) => {
                console.error("MCP gateway relay failed", error);
                publishMcpGatewayStatus("degraded");
              },
            );
          } else if (state === "degraded" || state === "disabled") {
            stopRelays?.();
            stopRelays = undefined;
          }
        },
        onStatusSnapshot: publishMcpGatewayStatusSnapshot,
      });
      setMcpGatewayStatusRequester(() => bridge?.requestStatus() ?? false);
      unsubscribe?.();
      unsubscribe = null;
    };
    startWhenReady();
    if (bridge === null)
      unsubscribe = appAtomRegistry.subscribe(connectionAtomRuntime, startWhenReady);

    return () => {
      stopped = true;
      unsubscribe?.();
      stopRelays?.();
      bridge?.stop();
      setMcpGatewayStatusRequester(null);
      publishMcpGatewayStatusSnapshot(null);
      unmountRuntime();
    };
  }, [configuration, router, managedReady]);

  return null;
}
