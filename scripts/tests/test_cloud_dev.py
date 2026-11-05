"""Launcher regressions using synthetic configuration and child processes."""
import os
import unittest
from unittest.mock import patch, MagicMock
from scripts import cloud_dev

class CloudLauncherTests(unittest.TestCase):
    def test_cloud_environment_does_not_inherit_local_or_expose_credentials_to_vite(self):
        config = {'SUPABASE_DB_URL':'postgresql://synthetic.invalid/example',
                  'GOOGLE_API_KEY':'synthetic-key','LERNE_MODE':'LOCAL',
                  'LERNE_LOCAL_CONFIG':'wrong', 'VITE_API_URL':'https://wrong.invalid',
                  'LERNE_SSO_ISSUER':'https://identity.example.invalid'}
        with patch.dict(os.environ, {'LERNE_MODE':'LOCAL','VITE_LERNE_LOCAL':'1'}, clear=True), patch('dotenv.dotenv_values', return_value=config):
            api, frontend = cloud_dev.environment()
        self.assertNotIn('LERNE_MODE', api)
        self.assertNotIn('LERNE_LOCAL_CONFIG', api)
        self.assertEqual(api['LERNE_SSO_ISSUER'], config['LERNE_SSO_ISSUER'])
        self.assertEqual(api['PYTHON_DOTENV_DISABLED'], '1')
        self.assertNotIn('GOOGLE_API_KEY', frontend)
        self.assertNotIn('SUPABASE_DB_URL', frontend)
        self.assertEqual(frontend['VITE_API_URL'], '/api')

    def test_startup_failure_stops_only_owned_processes(self):
        owned = MagicMock()
        owned.poll.return_value = None
        with patch.object(cloud_dev, 'environment', return_value=({}, {})), patch.object(cloud_dev.Path, 'is_file', return_value=True), patch.object(cloud_dev.socket, 'socket'), patch.object(cloud_dev.subprocess, 'Popen', side_effect=[owned, OSError('fixture')]) as launch:
            with self.assertRaises(OSError): cloud_dev.start()
        owned.terminate.assert_called_once()
        api_command = launch.call_args_list[0].args[0]
        self.assertEqual(api_command[-2:], ['--lifespan', 'off'])
        self.assertIn('--host', api_command)

    def test_missing_configuration_fails_before_launch(self):
        with patch('dotenv.dotenv_values', return_value={}), patch.object(cloud_dev.subprocess, 'Popen') as launch:
            with self.assertRaises(RuntimeError): cloud_dev.start()
        launch.assert_not_called()
