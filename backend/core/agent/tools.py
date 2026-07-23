"""DS Agent tool registry. OpenAI Chat Completions tool schema is
{"type": "function", "function": {name, description, parameters}} - not
Anthropic's flatter {name, description, input_schema}. Destructiveness is
our own routing metadata, kept out of the schema actually sent to the API
(a stray key there would be rejected/ignored) and tracked as a separate
name-keyed set instead."""

TOOLS: list[dict] = [
    {
        "type": "function",
        "function": {
            "name": "fetch_data_sample",
            "description": "Fetch a data sample for a candidate signal from the feature store.",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name": {"type": "string"},
                    "start_date": {"type": "string", "format": "date"},
                    "end_date": {"type": "string", "format": "date"},
                },
                "required": ["signal_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compute_ic",
            "description": "Compute Spearman IC for a signal at multiple lags with Bonferroni correction.",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name": {"type": "string"},
                    "lags": {"type": "array", "items": {"type": "integer"}},
                    "target": {
                        "type": "string",
                        "enum": ["regime_label", "wti_return_5d", "wti_return_20d"],
                    },
                },
                "required": ["signal_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compute_oos_decay",
            "description": "Compute out-of-sample IC decay for a signal (train period vs OOS period).",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name": {"type": "string"},
                    "train_end": {"type": "string", "format": "date"},
                    "oos_start": {"type": "string", "format": "date"},
                },
                "required": ["signal_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "compute_feature_correlation",
            "description": "Compute correlation between a candidate signal and all existing active features.",
            "parameters": {
                "type": "object",
                "properties": {"signal_name": {"type": "string"}},
                "required": ["signal_name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "check_leakage",
            "description": "Verify no data leakage in the feature matrix given a gap and fold configuration.",
            "parameters": {
                "type": "object",
                "properties": {
                    "gap_days": {"type": "integer"},
                    "n_splits": {"type": "integer"},
                },
                "required": ["gap_days"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "add_to_feature_registry",
            "description": "Add a validated signal to the active feature pool (writes to features.yaml).",
            "parameters": {
                "type": "object",
                "properties": {
                    "signal_name": {"type": "string"},
                    "source": {"type": "string"},
                    "bearish_if_positive": {"type": "boolean"},
                    "frequency": {"type": "string"},
                    "category": {"type": "string"},
                },
                "required": ["signal_name", "source", "bearish_if_positive"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "run_training",
            "description": "Queue a model retraining job for one or more model types.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_types": {
                        "type": "array",
                        "items": {"type": "string", "enum": ["eia"]},
                    },
                    "gap_days": {"type": "integer"},
                    "n_splits": {"type": "integer"},
                },
                "required": ["model_types"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "deploy_model",
            "description": "Deploy the most recently trained model version to production.",
            "parameters": {
                "type": "object",
                "properties": {
                    "model_type": {"type": "string", "enum": ["eia"]},
                    "job_id": {"type": "string"},
                },
                "required": ["model_type", "job_id"],
            },
        },
    },
]

DESTRUCTIVE_TOOLS = {"add_to_feature_registry", "run_training", "deploy_model"}
