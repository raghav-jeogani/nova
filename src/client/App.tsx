import { useCallback, useState, type ChangeEvent } from "react";
import type { SelectChangeEvent } from "@mui/material/Select";
import {
  Alert,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
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

type RunResponse = {
  runId: string;
  run: {
    runId: string;
    customerId: string;
    stage: string;
    sourceFilename: string;
    sourceMime: string;
    extraction: Record<string, ExtractionField> | null;
    extractionRawJson: string | null;
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
    } | null;
    decision: { kind: string; reasoning: string; amendmentSummary?: unknown } | null;
    estimatedCostUsd: number | null;
    errorMessage: string | null;
  };
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

function statusChipColor(status: string): "success" | "error" | "warning" | "default" {
  if (status === "match") return "success";
  if (status === "mismatch") return "error";
  if (status === "uncertain") return "warning";
  return "default";
}

export function App() {
  const [customerId, setCustomerId] = useState("default-customer");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResponse | null>(null);
  const [nlQuestion, setNlQuestion] = useState("How many runs were flagged for human review?");
  const [nlResult, setNlResult] = useState<{ sql: string; rows: unknown[]; rowCount: number } | null>(null);
  const [nlError, setNlError] = useState<string | null>(null);

  const onSubmit = useCallback(async () => {
    setError(null);
    setResult(null);
    if (!file) {
      setError("Choose a PDF or image file.");
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("customerId", customerId);
      const res = await fetch("/api/runs", { method: "POST", body: fd });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setResult(json as RunResponse);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [file, customerId]);

  const onNl = useCallback(async () => {
    setNlError(null);
    setNlResult(null);
    try {
      const res = await fetch("/api/query/nl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: nlQuestion }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? res.statusText);
      setNlResult(json);
    } catch (e) {
      setNlError(e instanceof Error ? e.message : String(e));
    }
  }, [nlQuestion]);

  const extraction = result?.run.extraction;

  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Typography
        variant="h4"
        component="h1"
        gutterBottom
        sx={{ bgcolor: "common.black", color: "common.white", px: 2, py: 1.5 }}
      >
        Nova pipeline
      </Typography>
      <Typography variant="body1" color="text.secondary" paragraph>
        Upload one trade document (PDF or image). The API runs <strong>Extractor</strong> (vision) →{" "}
        <strong>Validator</strong> (rules) → <strong>Router</strong> (policy + reasoning) and persists the run to
        PostgreSQL.
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
        <Typography variant="h6" gutterBottom>
          1. Document
        </Typography>
        {loading && <LinearProgress sx={{ mb: 2 }} />}
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }} flexWrap="wrap">
          <FormControl sx={{ minWidth: 280 }}>
            <InputLabel id="customer-label">Customer ruleset</InputLabel>
            <Select
              labelId="customer-label"
              label="Customer ruleset"
              value={customerId}
              onChange={(e: SelectChangeEvent<string>) => setCustomerId(e.target.value)}
            >
              <MenuItem value="default-customer">default-customer (matches sample-clean)</MenuItem>
              <MenuItem value="demo-strict">demo-strict (forces mismatches)</MenuItem>
            </Select>
          </FormControl>
          <Button variant="outlined" component="label">
            {file ? file.name : "Choose file"}
            <input
              type="file"
              hidden
              accept=".pdf,image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Button>
          <Button variant="contained" disabled={loading} onClick={onSubmit}>
            {loading ? "Running pipeline…" : "Run pipeline"}
          </Button>
        </Stack>
        {error && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {error}
          </Alert>
        )}
      </Paper>

      {result && (
        <>
          <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
            <Typography variant="h6" gutterBottom>
              2. Extractor output
            </Typography>
            <Typography variant="body2" color="text.secondary" paragraph>
              Run <Box component="code">{result.runId}</Box> · stage <Box component="code">{result.run.stage}</Box>
              {result.run.estimatedCostUsd != null && (
                <>
                  {" "}
                  · est. cost <Box component="code">${result.run.estimatedCostUsd.toFixed(4)}</Box>
                </>
              )}
            </Typography>
            {result.run.errorMessage && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {result.run.errorMessage}
              </Alert>
            )}
            {extraction && (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Field</TableCell>
                      <TableCell>Value</TableCell>
                      <TableCell align="right">Confidence</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {Object.entries(extraction).map(([key, val]) => (
                      <TableRow key={key}>
                        <TableCell>{FIELD_LABELS[key] ?? key}</TableCell>
                        <TableCell>{val.value ?? "—"}</TableCell>
                        <TableCell align="right">{val.confidence.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
            <Typography variant="h6" gutterBottom>
              3. Validator
            </Typography>
            {result.run.validation ? (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Field</TableCell>
                      <TableCell>Status</TableCell>
                      <TableCell>Found</TableCell>
                      <TableCell>Expected / rule</TableCell>
                      <TableCell>Notes</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {result.run.validation.rows.map((r) => (
                      <TableRow key={r.field}>
                        <TableCell>{FIELD_LABELS[r.field] ?? r.field}</TableCell>
                        <TableCell>
                          <Chip label={r.status} size="small" color={statusChipColor(r.status)} variant="outlined" />
                        </TableCell>
                        <TableCell>{r.found ?? "—"}</TableCell>
                        <TableCell>{r.expected ?? "—"}</TableCell>
                        <TableCell sx={{ color: "text.secondary", maxWidth: 220 }}>{r.notes ?? ""}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <Typography color="text.secondary">No validation (pipeline may have failed early).</Typography>
            )}
          </Paper>

          <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
            <Typography variant="h6" gutterBottom>
              4. Router decision & reasoning
            </Typography>
            {result.run.decision ? (
              <Stack spacing={2}>
                <Chip label={result.run.decision.kind} color="primary" />
                <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
                  {result.run.decision.reasoning}
                </Typography>
                {result.run.decision.amendmentSummary != null ? (
                  <Box
                    component="pre"
                    sx={{
                      bgcolor: "action.hover",
                      p: 2,
                      borderRadius: 1,
                      overflow: "auto",
                      fontSize: 12,
                      m: 0,
                    }}
                  >
                    {JSON.stringify(result.run.decision.amendmentSummary, null, 2)}
                  </Box>
                ) : null}
              </Stack>
            ) : (
              <Typography color="text.secondary">No decision recorded.</Typography>
            )}
          </Paper>

          <Paper sx={{ p: 3, mb: 3 }} elevation={1}>
            <Typography variant="h6" gutterBottom>
              5. Raw extraction JSON (debug)
            </Typography>
            <Box
              component="pre"
              sx={{
                bgcolor: "action.hover",
                p: 2,
                borderRadius: 1,
                maxHeight: 240,
                overflow: "auto",
                fontSize: 12,
                m: 0,
              }}
            >
              {result.run.extractionRawJson ?? "—"}
            </Box>
          </Paper>
        </>
      )}

      <Paper sx={{ p: 3 }} elevation={1}>
        <Typography variant="h6" gutterBottom>
          Grounded NL → SQL (read-only)
        </Typography>
        <Typography variant="body2" color="text.secondary" paragraph>
          Questions are translated to a single <Box component="code">SELECT</Box> on <Box component="code">runs</Box>,
          then validated before execution.
        </Typography>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "flex-start" }}>
          <TextField
            label="Question"
            fullWidth
            multiline
            minRows={1}
            value={nlQuestion}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setNlQuestion(e.target.value)}
          />
          <Button variant="contained" onClick={onNl} sx={{ flexShrink: 0 }}>
            Run query
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
              }}
            >
              {JSON.stringify(nlResult.rows, null, 2)}
            </Box>
          </Box>
        )}
      </Paper>
    </Container>
  );
}
