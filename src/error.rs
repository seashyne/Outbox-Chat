use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Debug)]
pub enum ApiError {
    Unauthorized,
    Forbidden(&'static str),
    NotFound(&'static str),
    BadRequest(String),
    Conflict(String),
    Internal,
}

impl ApiError {
    fn status(&self) -> StatusCode {
        match self {
            ApiError::Unauthorized => StatusCode::UNAUTHORIZED,
            ApiError::Forbidden(_) => StatusCode::FORBIDDEN,
            ApiError::NotFound(_) => StatusCode::NOT_FOUND,
            ApiError::BadRequest(_) => StatusCode::BAD_REQUEST,
            ApiError::Conflict(_) => StatusCode::CONFLICT,
            ApiError::Internal => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }

    fn message(&self) -> String {
        match self {
            ApiError::Unauthorized => "invalid or missing token".into(),
            ApiError::Forbidden(reason) => (*reason).into(),
            ApiError::NotFound(what) => format!("{what} not found"),
            ApiError::BadRequest(msg) | ApiError::Conflict(msg) => msg.clone(),
            ApiError::Internal => "internal server error".into(),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if matches!(self, ApiError::Internal) {
            eprintln!("[error] internal server error");
        }
        (
            self.status(),
            Json(json!({ "error": self.message(), "status": self.status().as_u16() })),
        )
            .into_response()
    }
}
