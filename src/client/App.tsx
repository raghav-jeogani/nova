import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  LinearProgress,
  List,
  ListItemButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

type ExtractionField = { value: string | null; confidence: number };

type RunRow = {
  runId: string;
  shipmentId?: string | null;
  customerId: string;
  createdAt?: string;
  stage: string;
  sourceFilename: string;
  sourceFilenames?: string[] | null;
  inboxSubject?: string | null;
  extraction: Record<string, ExtractionField> | null;
  validation: {
    rows: Array<{
      field: string;
      status: string;
      found?: string | null;
      expected?: string | null;
      notes?: string;
    }>;
    hasUncertain: boolean;
    hasMismatch: boolean;
    perDocument?: Array<{
      filename: string;
      rows: Array<{
        field: string;
        status: string;
        found?: string | null;
        expected?: string | null;
        notes?: string;
      }>;
      hasUncertain: boolean;
      hasMismatch: boolean;
    }>;
    crossDocument?: {
      rows: Array<{
        field: string;
        status: string;
        expected?: string | null;
        notes?: string;
        foundByDocument: Array<{
          filename: string;
          value: string | null;
          confidence: number;
          sourceSnippet?: string | null;
        }>;
      }>;
      hasInconsistency: boolean;
    };
  } | null;
  decision: {
    kind: string;
    reasoning: string;
    draftReply?: string;
    amendmentSummary?: Array<{
      field: string;
      found: string | null;
      expected: string | null;
      sourceSnippet?: string | null;
    }>;
  } | null;
  draftReply?: string | null;
  estimatedCostUsd: number | null;
  errorMessage: string | null;
};

const FIELD_LABELS: Record<string, string> = {
  consigneeName: "Consignee",
  hsCode: "HS code",
  portOfLoading: "Port of loading",
  portOfDischarge: "Port of discharge",
  incoterms: "Incoterms",
  descriptionOfGoods: "Description of goods",
  grossWeight: "Gross weight",
  invoiceNumber: "Invoice number",
};

function statusChipColor(status: string): "success" | "error" | "warning" | "default" | "info" {
  if (status === "match") return "success";
  if (status === "mismatch") return "error";
  if (status === "uncertain") return "warning";
  if (status === "inconsistent") return "error";
  if (status === "consistent") return "success";
  if (status === "insufficient_data") return "info";
  return "default";
}

function cellText(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  return t.length > 0 ? t : "—";
}

type CrossDocFoundEntry = {
  filename: string;
  value: string | null;
  confidence: number;
};

/** Unique non-empty values across attachments (case-insensitive dedupe, first spelling kept). */
function distinctAttachmentValues(docs: CrossDocFoundEntry[]): string[] {
  const map = new Map<string, string>();
  for (const d of docs) {
    const v = (d.value ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (!map.has(k)) map.set(k, v);
  }
  return [...map.values()];
}

function stageLabel(stage: string): string {
  if (stage === "uploaded" || stage === "extracting" || stage === "extracted" || stage === "validating") {
    return "Incoming";
  }
  if (stage === "validated" || stage === "routing") return "Verification result";
  if (stage === "persisted") return "Draft ready";
  if (stage === "failed") return "Failed";
  return stage;
}

function formatIncomingListTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function docImportFilenames(run: Pick<RunRow, "sourceFilenames" | "sourceFilename">): string[] {
  const list = run.sourceFilenames?.filter((f): f is string => Boolean(f?.trim()));
  if (list && list.length > 0) return list;
  const single = run.sourceFilename?.trim();
  return single ? [single] : [];
}

function dedupeLatestByShipment(rows: RunRow[]): RunRow[] {
  const seen = new Set<string>();
  const deduped: RunRow[] = [];
  for (const row of rows) {
    const key = row.shipmentId ?? row.runId;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  return deduped;
}

export function App() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [simulateError, setSimulateError] = useState<string | null>(null);
  const [loadingSimulate, setLoadingSimulate] = useState(false);
  const [selectedDiscrepancy, setSelectedDiscrepancy] = useState<{
    title: string;
    found: string;
    expected: string;
    snippet: string;
  } | null>(null);
  const [draftReply, setDraftReply] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [sendEmailLoading, setSendEmailLoading] = useState(false);
  const [sendEmailError, setSendEmailError] = useState<string | null>(null);
  const [sendEmailSuccess, setSendEmailSuccess] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [nlQuestion, setNlQuestion] = useState(
    "How many shipments for customer default-customer are pending review (flagged for human)?"
  );
  const [nlResult, setNlResult] = useState<{ sql: string; rows: unknown[]; rowCount: number } | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);
  const [nlLoading, setNlLoading] = useState(false);

  const selectedRun = useMemo(() => runs.find((run) => run.runId === selectedRunId) ?? null, [runs, selectedRunId]);
  const crossDocInconsistentRows = useMemo(() => {
    return selectedRun?.validation?.crossDocument?.rows.filter((r) => r.status === "inconsistent") ?? [];
  }, [selectedRun?.validation?.crossDocument]);
  const visibleRuns = useMemo(() => {
    if (showHistory) return runs.slice(0, 20);
    const active = runs.filter((run) =>
      ["uploaded", "extracting", "extracted", "validating", "validated", "routing"].includes(run.stage)
    );
    return (active.length > 0 ? active : runs).slice(0, 12);
  }, [runs, showHistory]);

  useEffect(() => {
    setDraftReply(selectedRun?.draftReply ?? selectedRun?.decision?.draftReply ?? "");
    setSelectedDiscrepancy(null);
    setSendEmailError(null);
    setSendEmailSuccess(false);
  }, [selectedRun?.runId, selectedRun?.draftReply, selectedRun?.decision?.draftReply]);

  const sendDraftEmail = useCallback(async () => {
    setSendEmailError(null);
    setSendEmailSuccess(false);
    const to = replyToEmail.trim();
    if (!to) {
      setSendEmailError("Enter the recipient email in To.");
      return;
    }
    if (!draftReply.trim()) {
      setSendEmailError("Draft reply is empty.");
      return;
    }
    const subjectBase = selectedRun?.inboxSubject?.trim() || "Shipment verification";
    const subject = `Re: ${subjectBase}`.slice(0, 200);
    setSendEmailLoading(true);
    try {
      const res = await fetch("/api/email/send-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, body: draftReply, subject }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? res.statusText);
      }
      setSendEmailSuccess(true);
    } catch (e) {
      setSendEmailError(e instanceof Error ? e.message : String(e));
    } finally {
      setSendEmailLoading(false);
    }
  }, [replyToEmail, draftReply, selectedRun?.inboxSubject]);

  const fetchRuns = useCallback(async (): Promise<RunRow[]> => {
    setLoadingRuns(true);
    try {
      const res = await fetch("/api/runs?limit=30");
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? res.statusText);
      }
      const all = (json.runs as RunRow[]) ?? [];
      const part2Rows = all.filter((row) => Boolean(row.shipmentId));
      const base = part2Rows.length > 0 ? part2Rows : all;
      const sorted = base
        .slice()
        .sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
      const next = dedupeLatestByShipment(sorted);
      setRuns(next);
      return next;
    } catch {
      setRuns([]);
      return [];
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    void fetchRuns();
  }, [fetchRuns]);

  const simulateIncoming = useCallback(async (template: "clean" | "messy" | "cross-inconsistent") => {
    setLoadingSimulate(true);
    setSimulateError(null);
    try {
      const res = await fetch("/api/inbox/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? res.statusText);
      }
      const targetShipmentId = typeof json.shipmentId === "string" ? json.shipmentId : null;
      let selected = false;
      // Poll briefly after simulate so UI reflects async watcher progress without full-page refresh.
      for (let i = 0; i < 15; i += 1) {
        const latest = await fetchRuns();
        const match = targetShipmentId ? latest.find((run) => run.shipmentId === targetShipmentId) : latest[0];
        if (match) {
          setSelectedRunId(match.runId);
          selected = true;
          if (match.stage === "persisted" || match.stage === "failed") {
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!selected) {
        await fetchRuns();
      }
    } catch (e) {
      setSimulateError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingSimulate(false);
    }
  }, [fetchRuns]);

  const runNlQuery = useCallback(async () => {
    setNlError(null);
    setNlResult(null);
    setNlLoading(true);
    try {
      const res = await fetch("/api/query/nl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nlQuestion }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? res.statusText);
      }
      setNlResult(json as { sql: string; rows: unknown[]; rowCount: number });
    } catch (e) {
      setNlError(e instanceof Error ? e.message : String(e));
    } finally {
      setNlLoading(false);
    }
  }, [nlQuestion]);

  return (
    <Container maxWidth="lg" sx={{ py: 4 }}>
      <Typography
        variant="h4"
        component="h1"
        gutterBottom
        sx={{ bgcolor: "common.black", color: "common.white", px: 2, py: 1.5 }}
      >
        Nova CG workflow
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        Incoming SU email attachments are processed into verification outcomes. CG reviews discrepancies and edits the
        draft reply before sending.
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
        <Typography variant="h6" gutterBottom>
          Incoming trigger (simulated SU inbox)
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Button variant="contained" disabled={loadingSimulate} onClick={() => void simulateIncoming("clean")}>
            Simulate clean shipment email
          </Button>
          <Button variant="outlined" disabled={loadingSimulate} onClick={() => void simulateIncoming("messy")}>
            Simulate messy shipment email
          </Button>
          <Button
            variant="outlined"
            color="warning"
            disabled={loadingSimulate}
            onClick={() => void simulateIncoming("cross-inconsistent")}
          >
            Simulate 3-doc cross mismatch
          </Button>
          <Button variant="text" disabled={loadingRuns} onClick={() => void fetchRuns()}>
            Refresh list
          </Button>
          <Button variant="text" onClick={() => setShowHistory((v) => !v)}>
            {showHistory ? "Hide history" : "Show history"}
          </Button>
        </Stack>
        {simulateError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {simulateError}
          </Alert>
        )}
      </Paper>

      <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
        <Paper sx={{ p: 2, flex: "0 0 320px" }} elevation={1}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6">Incoming</Typography>
            {loadingRuns && <LinearProgress sx={{ width: 96 }} />}
          </Stack>
          <List dense>
            {visibleRuns.map((run) => {
              const timePart = formatIncomingListTime(run.createdAt);
              const docCount = docImportFilenames(run).length;
              return (
                <ListItemButton
                  key={run.runId}
                  selected={run.runId === selectedRun?.runId}
                  onClick={() => setSelectedRunId(run.runId)}
                  alignItems="flex-start"
                  sx={{ flexDirection: "column", alignItems: "stretch", gap: 0.5, py: 1.25 }}
                >
                  <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ width: "100%" }}>
                    {timePart ? (
                      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 0 }}>
                        {timePart}
                      </Typography>
                    ) : (
                      <Box sx={{ flex: 1 }} />
                    )}
                    <Chip label={stageLabel(run.stage)} size="small" sx={{ flexShrink: 0 }} />
                  </Stack>
                  <Typography variant="body2" fontWeight={600} sx={{ lineHeight: 1.3 }} noWrap title={run.shipmentId ?? run.runId}>
                    {run.shipmentId ?? run.runId}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.35 }}>
                    #{run.customerId} · docs : {docCount}
                  </Typography>
                </ListItemButton>
              );
            })}
          </List>
        </Paper>

        <Stack spacing={3} sx={{ flex: 1 }}>
          {selectedRun ? (
            <>
              <Paper sx={{ p: 3 }} elevation={1}>
                <Stack spacing={0.75} sx={{ mb: 2 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ lineHeight: 1.2 }}>
                    Shipment
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {selectedRun.shipmentId ?? selectedRun.runId}
                  </Typography>
                  <Stack spacing={0.25}>
                    <Typography variant="body2">
                      <Box component="span" color="text.secondary">
                        customerId{" "}
                      </Box>
                      <Box component="code">{selectedRun.customerId}</Box>
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ pt: 0.25 }}>
                      Documents imported:
                    </Typography>
                    <Box component="ul" sx={{ m: 0, pl: 2.25, typography: "body2" }}>
                      {(() => {
                        const names = docImportFilenames(selectedRun);
                        const items = names.length > 0 ? names : ["—"];
                        return items.map((name, idx) => (
                          <Typography component="li" variant="body2" key={`${name}-${idx}`}>
                            {name}
                          </Typography>
                        ));
                      })()}
                    </Box>
                  </Stack>
                </Stack>
                <Typography variant="body2" color="text.secondary" paragraph sx={{ mb: 2 }}>
                  Run <Box component="code">{selectedRun.runId}</Box> · Stage <Box component="code">{selectedRun.stage}</Box>
                </Typography>
                {selectedRun.errorMessage && (
                  <Alert severity="error" sx={{ mb: 2 }}>
                    {selectedRun.errorMessage}
                  </Alert>
                )}
                {selectedRun.validation ? (
                  selectedRun.validation.perDocument && selectedRun.validation.perDocument.length > 0 ? (
                    <Stack spacing={3}>
                      {selectedRun.validation.perDocument.map((docBlock, docIdx) => (
                        <Box key={`${docBlock.filename}-${docIdx}`}>
                          <Typography variant="h6" gutterBottom>
                            Verification result for document {docIdx + 1}: {docBlock.filename}
                          </Typography>
                          <TableContainer>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>Field</TableCell>
                                  <TableCell>Status</TableCell>
                                  <TableCell>Found</TableCell>
                                  <TableCell>Expected</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {docBlock.rows.map((row) => (
                                  <TableRow
                                    key={`${docBlock.filename}-${row.field}`}
                                    hover
                                    onClick={() =>
                                      setSelectedDiscrepancy({
                                        title: `${FIELD_LABELS[row.field] ?? row.field} (${docBlock.filename})`,
                                        found: cellText(row.found),
                                        expected: cellText(row.expected),
                                        snippet: row.notes ?? "No source snippet available.",
                                      })
                                    }
                                    sx={{ cursor: "pointer" }}
                                  >
                                    <TableCell>{FIELD_LABELS[row.field] ?? row.field}</TableCell>
                                    <TableCell>
                                      <Chip label={row.status} color={statusChipColor(row.status)} size="small" />
                                    </TableCell>
                                    <TableCell>{cellText(row.found)}</TableCell>
                                    <TableCell>{cellText(row.expected)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </TableContainer>
                        </Box>
                      ))}
                    </Stack>
                  ) : (
                    <>
                      <Typography variant="h6" gutterBottom>
                        Verification result
                      </Typography>
                      <TableContainer>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Field</TableCell>
                              <TableCell>Status</TableCell>
                              <TableCell>Found</TableCell>
                              <TableCell>Expected</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {selectedRun.validation.rows.map((row) => (
                              <TableRow
                                key={row.field}
                                hover
                                onClick={() =>
                                  setSelectedDiscrepancy({
                                    title: FIELD_LABELS[row.field] ?? row.field,
                                    found: cellText(row.found),
                                    expected: cellText(row.expected),
                                    snippet: row.notes ?? "No source snippet available.",
                                  })
                                }
                                sx={{ cursor: "pointer" }}
                              >
                                <TableCell>{FIELD_LABELS[row.field] ?? row.field}</TableCell>
                                <TableCell>
                                  <Chip label={row.status} color={statusChipColor(row.status)} size="small" />
                                </TableCell>
                                <TableCell>{cellText(row.found)}</TableCell>
                                <TableCell>{cellText(row.expected)}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    </>
                  )
                ) : (
                  <Typography color="text.secondary">Verification is still running.</Typography>
                )}
              </Paper>

              <Paper sx={{ p: 3 }} elevation={1}>
                <Typography variant="h6" gutterBottom>
                  Discrepancy detail
                </Typography>
                {crossDocInconsistentRows.length > 0 && (
                  <Stack spacing={2.5} sx={{ mb: 3 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      A value can satisfy rules on one document but still disagree with another attachment for the same
                      shipment.
                    </Typography>
                    {crossDocInconsistentRows.map((row) => {
                      const distinct = distinctAttachmentValues(row.foundByDocument);
                      const label = FIELD_LABELS[row.field] ?? row.field;
                      return (
                        <Box
                          key={row.field}
                          sx={{
                            pl: 2,
                            borderLeft: (theme) => `4px solid ${theme.palette.error.main}`,
                          }}
                        >
                          <Typography variant="subtitle1" gutterBottom>
                            {label} — inconsistent across documents
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 1 }}>
                            <strong>Distinct values across attachments:</strong> {distinct.length > 0 ? distinct.join(", ") : "—"}
                          </Typography>
                          <Typography variant="body2" sx={{ mb: 0.5 }}>
                            <strong>Found by document:</strong>
                          </Typography>
                          <Box component="ul" sx={{ m: 0, pl: 2.5, mb: 1 }}>
                            {row.foundByDocument.map((doc) => (
                              <Typography key={doc.filename} component="li" variant="body2">
                                <strong>{doc.filename}:</strong> {cellText(doc.value)}
                              </Typography>
                            ))}
                          </Box>
                          {row.expected != null && String(row.expected).trim() !== "" && (
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                              <strong>Reference value (first non-empty attachment):</strong> {cellText(row.expected)}
                            </Typography>
                          )}
                          {row.notes && (
                            <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                              <strong>Notes:</strong> {row.notes}
                            </Typography>
                          )}
                        </Box>
                      );
                    })}
                  </Stack>
                )}
                {selectedDiscrepancy ? (
                  <Stack spacing={1} sx={{ mb: selectedRun.validation?.crossDocument ? 2 : 0 }}>
                    <Typography variant="subtitle2" color="text.secondary">
                      Selected field (from verification table)
                    </Typography>
                    <Typography variant="subtitle1">{selectedDiscrepancy.title}</Typography>
                    <Typography variant="body2">
                      <strong>Found:</strong> {selectedDiscrepancy.found}
                    </Typography>
                    <Typography variant="body2">
                      <strong>Expected:</strong> {selectedDiscrepancy.expected}
                    </Typography>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      <strong>Source snippet:</strong> {selectedDiscrepancy.snippet}
                    </Typography>
                  </Stack>
                ) : (
                  <Typography color="text.secondary" sx={{ mb: selectedRun.validation?.crossDocument ? 2 : 0 }}>
                    {crossDocInconsistentRows.length > 0
                      ? "Click any flagged row in a verification table above for single-document rule detail."
                      : "Click any flagged field from a verification table above to inspect mismatch details."}
                  </Typography>
                )}
                {selectedRun.validation?.crossDocument && (
                  <Box sx={{ mt: 2 }}>
                    <Typography variant="subtitle2" gutterBottom>
                      Cross-document checks (summary)
                    </Typography>
                    <TableContainer>
                      <Table size="small">
                        <TableHead>
                          <TableRow>
                            <TableCell>Field</TableCell>
                            <TableCell>Status</TableCell>
                            <TableCell>Values by document</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {selectedRun.validation.crossDocument.rows.map((row) => (
                            <TableRow key={row.field}>
                              <TableCell>{FIELD_LABELS[row.field] ?? row.field}</TableCell>
                              <TableCell>
                                <Chip label={row.status} size="small" color={statusChipColor(row.status)} />
                              </TableCell>
                              <TableCell>
                                {row.foundByDocument
                                  .map((doc) => `${doc.filename}: ${doc.value ?? "missing"}`)
                                  .join(" | ")}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                )}
              </Paper>

              <Paper sx={{ p: 3 }} elevation={1}>
                <Typography variant="h6" gutterBottom>
                  Draft reply (editable)
                </Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={8}
                  value={draftReply}
                  onChange={(e) => setDraftReply(e.target.value)}
                />
                <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 1 }}>
                  Review before sending. The server sends mail over Gmail SMTP using credentials in the environment
                  (not from the browser).
                </Typography>
                <TextField
                  fullWidth
                  type="email"
                  label="To"
                  placeholder="recipient@example.com"
                  value={replyToEmail}
                  onChange={(e) => setReplyToEmail(e.target.value)}
                  sx={{ mt: 2 }}
                  autoComplete="email"
                  helperText="Recipient for the draft reply below."
                />
                {sendEmailError && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {sendEmailError}
                  </Alert>
                )}
                {sendEmailSuccess && (
                  <Alert severity="success" sx={{ mt: 2 }}>
                    Email sent.
                  </Alert>
                )}
                <Button
                  variant="contained"
                  color="primary"
                  sx={{ mt: 2 }}
                  disabled={sendEmailLoading}
                  onClick={() => void sendDraftEmail()}
                >
                  {sendEmailLoading ? "Sending…" : "Send email"}
                </Button>
              </Paper>
            </>
          ) : (
            <Paper sx={{ p: 3 }} elevation={1}>
              <Typography color="text.secondary">
                No shipment selected yet. Simulate one (or select from Incoming) to view verification details.
              </Typography>
            </Paper>
          )}

          <Paper sx={{ p: 3 }} elevation={1}>
            <Typography variant="h6" gutterBottom>
              Grounded NL → SQL (read-only)
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Ask analytics questions in plain English. The server translates to a single{" "}
              <Box component="code">SELECT</Box> on <Box component="code">runs</Box>, validates it, then executes it.
              Example: pending review by customer, counts by <Box component="code">decision_kind</Box>, etc.
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "flex-start" }}>
              <TextField
                label="Question"
                fullWidth
                multiline
                minRows={2}
                value={nlQuestion}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNlQuestion(e.target.value)}
              />
              <Button
                variant="contained"
                onClick={() => void runNlQuery()}
                disabled={nlLoading}
                sx={{ flexShrink: 0, alignSelf: { sm: "flex-start" } }}
              >
                {nlLoading ? "Running…" : "Run query"}
              </Button>
            </Stack>
            {nlError && (
              <Alert severity="error" sx={{ mt: 2 }}>
                {nlError}
              </Alert>
            )}
            {nlResult && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" gutterBottom>
                  SQL: <Box component="code">{nlResult.sql}</Box>
                </Typography>
                <Typography variant="body2" gutterBottom>
                  Rows: <strong>{nlResult.rowCount}</strong>
                </Typography>
                <Box
                  component="pre"
                  sx={{
                    bgcolor: "action.hover",
                    p: 2,
                    borderRadius: 1,
                    overflow: "auto",
                    fontSize: 12,
                    m: 0,
                    maxHeight: 280,
                  }}
                >
                  {JSON.stringify(nlResult.rows, null, 2)}
                </Box>
              </Box>
            )}
          </Paper>
        </Stack>
      </Stack>
    </Container>
  );
}
