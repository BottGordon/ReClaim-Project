from common import ApiError, clean, find, item_id, required, timestamp
from records import normalize_image, open_found

DEMO_ANALYTICS = [
    {"location": "University Library", "reports": 48, "returned": 45},
    {"location": "Gusaling Villegas (GV)", "reports": 39, "returned": 35},
    {"location": "University Activity Center", "reports": 31, "returned": 29},
    {"location": "Gusaling Katipunan (GK)", "reports": 24, "returned": 21},
    {"location": "Gusaling Lacson (GL)", "reports": 19, "returned": 17},
]


class Admin:
    def __init__(self, records):
        self.records = records

    def can_match(self, lost, found):
        return (
            lost and lost["status"] == "Lost" and lost.get("privacy") != "Held" and open_found(found)
            and lost["category"] == found["category"] and lost["ownerId"] != found["ownerId"]
            and find(self.records.users, id=lost["ownerId"])
        )

    def overview(self, user):
        records = self.records
        users = []
        for entry in records.users:
            if not entry.get("emailVerified"):
                continue
            summary = {key: entry[key] for key in ("id", "name", "email", "studentNumber", "staffId") if key in entry}
            summary["role"] = "Admin" if entry["id"] == user["id"] else entry["accountType"]
            users.append(summary)

        lost_items = [item for item in records.items if item["status"] == "Lost"]
        found_items = [item for item in records.items if open_found(item)]
        linked = {(match["lostId"], match["foundId"]) for match in records.matches}
        matches = [
            {"lostId": lost["id"], "foundId": found["id"], "linked": False}
            for lost in lost_items for found in found_items
            if (lost["id"], found["id"]) not in linked and self.can_match(lost, found)
        ]
        matches.extend(
            {"lostId": match["lostId"], "foundId": match["foundId"], "linked": True} for match in records.matches
        )
        threads = [
            {
                "claimId": thread["adminClaimId"],
                "messages": [
                    {"id": message["id"], "text": message["text"], "time": message["time"], "mine": message["senderId"] == user["id"]}
                    for message in thread["messages"]
                ],
            }
            for thread in records.conversations if thread.get("adminClaimId") and user["id"] in thread["participantIds"]
        ]
        stats = {
            "items": len(records.items),
            "pendingClaims": sum(claim["status"] == "Pending" for claim in records.claims),
            "returnedItems": sum(item["status"] == "Returned" for item in records.items),
            "inCustody": sum(bool(item.get("custodyDeskId") or item.get("previousCustodyDesk")) and item["status"] != "Returned" for item in records.items),
            "activeReports": sum(item["status"] != "Returned" and item.get("privacy") != "Held" for item in records.items),
            "returnRate": 0,
            "analytics": [],
        }
        if records.store.data.get("presentationSeed"):
            stats.update(returnedItems=142, inCustody=14, activeReports=38, returnRate=92, analytics=DEMO_ANALYTICS)
        return 200, {
            "users": users, "items": [normalize_image(item) for item in records.items], "claims": records.claims,
            "desks": records.desks, "matches": matches, "notifications": records.inbox(user),
            "claimThreads": threads, "stats": stats,
        }

    def active_desk(self, value):
        desk = find(self.records.desks, id=value)
        return desk if desk and desk.get("active") else None

    def log_walk_in(self, user, data):
        desk = self.active_desk(data.get("deskId"))
        if desk is None:
            raise ApiError(400, "Select an active custody desk.")
        return self.records.create_item(user, data, desk)

    def update_claim(self, user, value, data, send_message):
        records = self.records
        claim, item = records.claim_and_item(value)
        if send_message:
            text = required(data.get("text"), "Message", 2000)
            claimant = claim["claimantId"]
            if claimant == user["id"] or not find(records.users, id=claimant):
                raise ApiError(409, "The claimant cannot receive messages.")
            thread = next((entry for entry in records.conversations if entry.get("adminClaimId") == claim["id"] and user["id"] in entry["participantIds"]), None)
            if thread is None:
                thread = records.new_thread(item, [user["id"], claimant], claim["id"])
            records.add_message(thread, user["id"], text)
            records.notify(claimant, "message", "Message from the OSDS desk", f"The OSDS desk sent you a message about {item['name']}.", "chat")
        else:
            records.review_claim(claim, item, data.get("status"))
        records.store.save()
        return 200, {"claim": claim, "item": item}

    def update_item(self, value, action, data):
        item = self.records.item(value)
        if item is None:
            raise ApiError(404, "Item not found.")
        if action == "status":
            if data.get("status") != "Returned":
                raise ApiError(400, "Choose Returned to record a handover.")
            self.records.complete_return(item)
        elif action == "custody":
            if item["status"] in ("Returned", "Lost"):
                raise ApiError(409, "Only recovered items awaiting release can change custody.")
            desk = self.active_desk(data.get("deskId"))
            if desk:
                item.update(custodyDeskId=desk["id"], shelfTag=clean(data.get("shelfTag"), 120))
            elif "deskId" in data and data["deskId"] is None:
                item.pop("custodyDeskId", None)
                item.pop("shelfTag", None)
            else:
                raise ApiError(400, "Select an active desk or With Finder.")
            item.pop("previousCustodyDesk", None)
        else:
            self.moderate(item, data)
        self.records.store.save()
        return 200, {"item": item}

    @staticmethod
    def moderate(item, data):
        if data.get("action") == "hold":
            item["privacy"] = "Held"
            return
        if data.get("action") != "publish":
            raise ApiError(400, "Choose hold or publish.")
        if item.get("privacy") != "Held":
            raise ApiError(409, "Only held reports can be published from privacy review.")
        name = required(data.get("name"), "Redacted title", 120)
        description = required(data.get("description"), "Redacted description", 1500)
        question = required(data.get("question"), "Public ownership question", 200) if item.get("question") else None
        if not item.get("originalContent"):
            item["originalContent"] = {key: item[key] for key in ("name", "description", "image", "question") if key in item}
        item.update(name=name, description=description, image="", privacy="Published")
        if question is None:
            item.pop("question", None)
        else:
            item["question"] = question

    def link_match(self, user, data):
        records = self.records
        lost_id, found_id = item_id(data.get("lostId")), item_id(data.get("foundId"))
        if find(records.matches, lostId=lost_id, foundId=found_id):
            return 200, {"ok": True}
        lost, found = records.item(lost_id), records.item(found_id)
        if not self.can_match(lost, found):
            raise ApiError(409, "These reports are no longer eligible for a match.")
        records.matches.append({"lostId": lost["id"], "foundId": found["id"], "linkedAt": timestamp(), "linkedBy": user["id"]})
        records.notify(
            lost["ownerId"], "match", "Possible match found",
            f"The OSDS desk identified {found['name']} in Browse as a possible match for {lost['name']}.", "browse",
        )
        records.store.save()
        return 200, {"ok": True}

    def update_desk(self, value, data):
        desk = find(self.records.desks, id=value)
        if desk is None:
            raise ApiError(404, "Custody desk not found.")
        if not isinstance(data.get("active"), bool):
            raise ApiError(400, "Supply an active or paused state.")
        desk["active"] = data["active"]
        self.records.store.save()
        return 200, {"desk": desk}
