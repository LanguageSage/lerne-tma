import unittest
import os
import sys
import datetime
import json
from peewee import SqliteDatabase

# Ensure root directory is in python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

test_db = SqliteDatabase(':memory:')

from api.models import (
    tma_db, TMAUser, TMA_Folder, TMA_Deck, TMA_Collaborator
)
from api.services.decks import create_deck, get_next_deck_position

class TestDeckPosition(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        # Bind models to in-memory db
        models = [TMAUser, TMA_Folder, TMA_Deck, TMA_Collaborator]
        test_db.bind(models, bind_refs=False, bind_backrefs=False)
        tma_db.initialize(test_db)
        test_db.connect()
        test_db.create_tables(models)

    def setUp(self):
        # Clean database tables before each test
        TMA_Collaborator.delete().execute()
        TMA_Deck.delete().execute()
        TMA_Folder.delete().execute()
        TMAUser.delete().execute()

        # Create standard test users
        self.owner = TMAUser.create(user_id=101, username="owner", first_name="Owner")
        self.editor = TMAUser.create(user_id=102, username="editor", first_name="Editor")

    def test_1_empty_folder(self):
        """1. Пустая папка: создать deck -> position = 0"""
        folder = TMA_Folder.create(user_id=self.owner.user_id, name="Test Folder 1")
        deck = create_deck(name="Deck 1", user_id=self.owner.user_id, folder_id=folder.id)
        self.assertEqual(deck.position, 0)

    def test_2_folder_sequential(self):
        """2. Папка c позициями 0, 1, 2: создать deck -> position = 3"""
        folder = TMA_Folder.create(user_id=self.owner.user_id, name="Test Folder 2")
        for i in range(3):
            TMA_Deck.create(user_id=self.owner.user_id, name=f"Deck {i}", folder_id=folder.id, position=i)

        new_deck = create_deck(name="New Deck", user_id=self.owner.user_id, folder_id=folder.id)
        self.assertEqual(new_deck.position, 3)

    def test_3_folder_gaps(self):
        """3. Папка с позициями 0, 5, 10: создать deck -> position = 11"""
        folder = TMA_Folder.create(user_id=self.owner.user_id, name="Test Folder 3")
        for pos in [0, 5, 10]:
            TMA_Deck.create(user_id=self.owner.user_id, name=f"Deck {pos}", folder_id=folder.id, position=pos)

        new_deck = create_deck(name="New Deck", user_id=self.owner.user_id, folder_id=folder.id)
        self.assertEqual(new_deck.position, 11)

    def test_4_deleted_deck_ignored(self):
        """4. Удалённая колода с pos=20 и активная с pos=5: новая должна получить 6"""
        folder = TMA_Folder.create(user_id=self.owner.user_id, name="Test Folder 4")
        TMA_Deck.create(user_id=self.owner.user_id, name="Active Deck", folder_id=folder.id, position=5, is_deleted=False)
        TMA_Deck.create(user_id=self.owner.user_id, name="Deleted Deck", folder_id=folder.id, position=20, is_deleted=True)

        new_deck = create_deck(name="New Deck", user_id=self.owner.user_id, folder_id=folder.id)
        self.assertEqual(new_deck.position, 6)

    def test_5_shared_folder(self):
        """5. Shared folder: owner deck pos 0, editor deck pos 1. Editor создаёт новую -> position = 2"""
        folder = TMA_Folder.create(user_id=self.owner.user_id, name="Shared Folder")
        TMA_Collaborator.create(target_type='folder', target_id=folder.id, user_id=self.editor.user_id, role='editor', added_by=self.owner.user_id)

        TMA_Deck.create(user_id=self.owner.user_id, name="Owner Deck", folder_id=folder.id, position=0)
        TMA_Deck.create(user_id=self.editor.user_id, name="Editor Deck", folder_id=folder.id, position=1)

        editor_new_deck = create_deck(name="Editor New Deck", user_id=self.editor.user_id, folder_id=folder.id)
        self.assertEqual(editor_new_deck.position, 2)

    def test_6_root_language_isolation(self):
        """6. Root DE: positions 0,1,2. Root EN: positions 0..5. Создем DE -> position = 3 (а не 6)"""
        for i in range(3):
            TMA_Deck.create(user_id=self.owner.user_id, name=f"DE Deck {i}", target_language='de', position=i)
        for i in range(6):
            TMA_Deck.create(user_id=self.owner.user_id, name=f"EN Deck {i}", target_language='en', position=i)

        new_de_deck = create_deck(name="New DE Deck", user_id=self.owner.user_id, target_language='de')
        self.assertEqual(new_de_deck.position, 3)


if __name__ == '__main__':
    unittest.main()
