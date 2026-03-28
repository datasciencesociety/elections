"""Integration tests for main application."""

import pytest
from election_protocols_be.main import app
from fastapi.testclient import TestClient


@pytest.mark.integration
class TestMainApp:
    """Tests for main FastAPI application."""

    @pytest.fixture
    def client(self):
        """Create TestClient for the FastAPI app."""
        return TestClient(app)

    def test_health_endpoint_returns_200(self, client):
        """Test GET /health returns 200 and expected structure."""
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "OK"
        assert "version" in data

    def test_root_endpoint_returns_200(self, client):
        """Test GET / returns 200 and expected message."""
        response = client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "Election Protocols Backend" in data["message"]

    def test_health_endpoint_has_version(self, client):
        """Test health endpoint includes version string."""
        response = client.get("/health")
        data = response.json()
        assert isinstance(data["version"], str)
        assert len(data["version"]) > 0
